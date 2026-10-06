import type { ProblemIR } from "./problemIR";

export interface DcBranch {
  id: string;
  kind: "resistor" | "voltage_source" | "current_source" | "wire" | "open";
  from: string;
  to: string;
  connectionConstraintId: string;
  lawFactId: string;
  quantityExpressionId?: string;
  quantityFactId?: string;
  unit?: string;
}

export interface DcNetwork {
  model: "ideal_dc";
  modelFactId: string;
  nodes: string[];
  referenceNode: string;
  referenceFactId?: string;
  branches: DcBranch[];
}

export interface DcExactValue {
  exact: string;
  approximate: number;
}

export interface DcNetworkSolution {
  referenceNode: string;
  voltages: Record<string, DcExactValue>;
  currents: Record<string, DcExactValue>;
  expressionIds: string[];
  residual: 0;
  lawChecks: number;
}

export type DcNetworkOutput = { kind: "node_voltage" | "branch_current"; id: string };

type Rational = { n: bigint; d: bigint };
const ZERO: Rational = { n: 0n, d: 1n };
const ONE: Rational = { n: 1n, d: 1n };
const MAX_BITS = 512;
const ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const UNITS: Record<string, { dimension: DcBranch["kind"]; factor: string }> = {
  ohm: { dimension: "resistor", factor: "1" },
  "Ω": { dimension: "resistor", factor: "1" },
  kohm: { dimension: "resistor", factor: "1000" },
  "kΩ": { dimension: "resistor", factor: "1000" },
  Mohm: { dimension: "resistor", factor: "1000000" },
  "MΩ": { dimension: "resistor", factor: "1000000" },
  V: { dimension: "voltage_source", factor: "1" },
  mV: { dimension: "voltage_source", factor: "0.001" },
  A: { dimension: "current_source", factor: "1" },
  mA: { dimension: "current_source", factor: "0.001" },
  "µA": { dimension: "current_source", factor: "0.000001" },
};

export class DcNetworkError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never { throw new DcNetworkError(code, message); }
function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function keys(value: Record<string, unknown>, allowed: string[], required: string[] = []): void {
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) fail("invalid_network_input", "Network input requires its own source fields and rejects unsupported fields");
}
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  while (b !== 0n) { const next = a % b; a = b; b = next; }
  return a;
}
function rational(n: bigint, d = 1n): Rational {
  if (d === 0n) fail("invalid_network_arithmetic", "Zero rational denominator");
  if (d < 0n) { n = -n; d = -d; }
  const divisor = gcd(n, d);
  n /= divisor; d /= divisor;
  if (n.toString(2).replace("-", "").length > MAX_BITS || d.toString(2).length > MAX_BITS) fail("network_capacity", "Exact network arithmetic exceeds 512-bit capacity");
  return { n, d };
}
function add(a: Rational, b: Rational): Rational { return rational(a.n * b.d + b.n * a.d, a.d * b.d); }
function neg(a: Rational): Rational { return { n: -a.n, d: a.d }; }
function sub(a: Rational, b: Rational): Rational { return add(a, neg(b)); }
function mul(a: Rational, b: Rational): Rational { return rational(a.n * b.n, a.d * b.d); }
function div(a: Rational, b: Rational): Rational { return rational(a.n * b.d, a.d * b.n); }
function decimal(text: string): Rational {
  const match = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match || text.length > 40) fail("invalid_source_quantity", "Quantity requires a bounded decimal literal");
  const exponent = Number(match[3] ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 24) fail("invalid_source_quantity", "Decimal exponent exceeds the supported domain");
  const parts = match[2].split(".");
  const scale = (parts[1]?.length ?? 0) - exponent;
  if (Math.abs(scale) > 40) fail("invalid_source_quantity", "Decimal precision exceeds the supported domain");
  const n = BigInt(parts.join("")) * (match[1] === "-" ? -1n : 1n);
  return scale >= 0 ? rational(n, 10n ** BigInt(scale)) : rational(n * 10n ** BigInt(-scale));
}
function bounded(value: Rational): DcExactValue {
  const magnitude = value.n < 0n ? -value.n : value.n;
  if (magnitude > value.d * 1000000000000n || magnitude !== 0n && magnitude * 1000000000000n < value.d) fail("network_domain", "Nonzero SI inputs/results must lie in [1e-12, 1e12] by magnitude");
  const approximate = Number(value.n) / Number(value.d);
  if (!Number.isFinite(approximate) || value.n !== 0n && approximate === 0) fail("network_domain", "Exact quantity cannot be represented as a finite nonzero scalar");
  return { exact: value.d === 1n ? String(value.n) : `${value.n}/${value.d}`, approximate: approximate === 0 ? 0 : approximate };
}
type DcSourceAssertion = {
  kind: "header" | "model" | "nodes" | "connection" | "law" | "reference" | "request";
  start: number;
  end: number;
  positiveEnd: number;
  names: string[];
  owner?: string;
};

function dcSourceAssertions(question: string): DcSourceAssertion[] {
  if (typeof question !== "string" || question.length > 16000) fail("unsupported_source_context", "DC source requires a bounded complete assertion document");
  const name = "([A-Za-z][A-Za-z0-9_]{0,63})";
  const names = "([A-Za-z][A-Za-z0-9_]{0,63}(?:\\s+(?:and\\s+)?[A-Za-z][A-Za-z0-9_]{0,63})*)";
  const amount = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)\\s+([A-Za-zΩµ]+)";
  const patterns: { kind: DcSourceAssertion["kind"]; pattern: RegExp; anonymous?: boolean }[] = [
    { kind: "header", pattern: new RegExp(`^(?:An\\s+)?ideal\\s+DC\\s+circuit\\s+has\\s+nodes\\s+${names}`, "i") },
    { kind: "model", pattern: /^ideal\s+DC(?:\s+circuit)?/i },
    { kind: "nodes", pattern: new RegExp(`^Nodes\\s+${names}`, "i") },
    { kind: "connection", pattern: new RegExp(`^(?:(?:Component|Resistor|Wire|Switch|Source)\\s+)?${name}\\s+connects\\s+${name}\\s+to\\s+${name}(?:\\s*,\\s*not\\s+${name})?`) },
    { kind: "law", pattern: new RegExp(`^V\\(${name}\\)\\s*-\\s*V\\(${name}\\)\\s*=\\s*${amount}`), anonymous: true },
    { kind: "law", pattern: new RegExp(`^I\\(${name}\\s*->\\s*${name}\\)\\s*=\\s*${amount}`), anonymous: true },
    { kind: "law", pattern: new RegExp(`^${name}\\s*=\\s*${amount}`) },
    { kind: "reference", pattern: new RegExp(`^V\\(${name}\\)\\s*=\\s*0\\s+V`) },
    { kind: "request", pattern: new RegExp(`^Find\\s+current\\s+${name}\\s+through\\s+${name}`) },
  ];
  const assertions: DcSourceAssertion[] = [];
  let cursor = 0;
  while (cursor < question.length) {
    cursor += /^\s*/.exec(question.slice(cursor))![0].length;
    if (cursor === question.length) break;
    if (assertions.length) {
      if (!/[.;,]/.test(question[cursor])) fail("unsupported_source_context", "DC assertions require explicit clause boundaries and complete supported surrounding context");
      cursor += 1;
      cursor += /^\s*/.exec(question.slice(cursor))![0].length;
      if (cursor === question.length) break;
    }
    const remaining = question.slice(cursor);
    const matched = patterns.map((rule) => ({ ...rule, match: rule.pattern.exec(remaining) })).find((rule) => rule.match && /^\s*(?:[.;,]|$)/.test(remaining.slice(rule.match[0].length)));
    if (!matched?.match || assertions.length >= 96) fail("unsupported_source_context", "The entire DC source must consist of supported affirmative declarations; quotation, discourse and unparsed text cannot supply facts");
    const { match, kind } = matched;
    const end = cursor + match[0].length;
    const names = kind === "nodes" || kind === "header" ? match[1].split(/\s+(?:and\s+)?/) : match.slice(1).filter((value): value is string => value !== undefined);
    const previous = assertions.at(-1);
    if (matched.anonymous && previous?.kind !== "connection") fail("unsupported_source_context", "An oriented branch law must follow its named component connection");
    const owner = kind === "law" ? matched.anonymous ? previous!.names[0] : match[1] : undefined;
    const positiveEnd = kind === "connection" && match[4] ? cursor + match[0].slice(0, match[0].lastIndexOf(",")).trimEnd().length : end;
    if (kind === "connection" && match[4] && [match[2], match[3]].includes(match[4])) fail("source_topology_mismatch", "An endpoint cannot also be explicitly excluded by its own source assertion");
    assertions.push({ kind, start: cursor, end, positiveEnd, names, ...(owner ? { owner } : {}) });
    cursor = end;
  }
  if (assertions.filter((item) => item.kind === "header" || item.kind === "model").length !== 1 || assertions.filter((item) => item.kind === "header" || item.kind === "nodes").length !== 1) fail("unsupported_source_context", "DC source requires one explicit ideal model and one complete node declaration");
  return assertions;
}

function sourceAssertion(assertions: DcSourceAssertion[], start: number, end: number): DcSourceAssertion | undefined {
  return assertions.find((item) => item.kind !== "request" && start >= item.start && end <= item.positiveEnd);
}

function sourceFact(problem: ProblemIR, id: string, assertions = dcSourceAssertions(problem.question)) {
  const fact = problem.facts.find((candidate) => candidate.id === id);
  if (!fact || !["id", "kind", "evidence"].every((key) => Object.hasOwn(fact, key)) || !["given", "assumption"].includes(fact.kind)) fail("ungrounded_network", `Network requires a supplied source fact ${id}`);
  const evidence = fact.evidence;
  if (!evidence || !["source", "start", "end", "quote"].every((key) => Object.hasOwn(evidence, key)) || evidence.source !== "question" || !Number.isInteger(evidence.start) || !Number.isInteger(evidence.end) || evidence.start < 0 || evidence.end <= evidence.start || problem.question.slice(evidence.start, evidence.end) !== evidence.quote || !evidence.quote.trim()) fail("ungrounded_network", `Fact ${id} must address its exact question quote`);
  if (!sourceAssertion(assertions, evidence.start, evidence.end)) {
    const parent = assertions.find((item) => evidence.start >= item.start && evidence.end <= item.end);
    fail(parent?.kind === "connection" ? "source_topology_mismatch" : "unsupported_source_context", "Source evidence must belong to a completely parsed affirmative assertion, not an excluded endpoint, request or quoted fragment");
  }
  return fact;
}

export function validateDcNetwork(problem: ProblemIR, raw: unknown): DcNetwork {
  if (!record(raw)) fail("invalid_network_input", "DC network must be a typed object");
  keys(raw, ["model", "modelFactId", "nodes", "referenceNode", "referenceFactId", "branches"], ["model", "modelFactId", "nodes", "referenceNode", "branches"]);
  if (raw.model !== "ideal_dc" || typeof raw.modelFactId !== "string") fail("invalid_network_model", "An explicit source-supported ideal DC model is required");
  const assertions = dcSourceAssertions(problem.question);
  const usedConnections = new Set<number>();
  const usedLaws = new Set<number>();
  const modelFact = sourceFact(problem, raw.modelFactId, assertions);
  if (!/^ideal\s+DC(?:\s+circuit)?$/i.test(modelFact.evidence.quote.trim())) fail("invalid_network_model", "The source must explicitly state the supported ideal DC assumption");
  if (!Array.isArray(raw.nodes) || raw.nodes.length < 2 || raw.nodes.length > 16 || raw.nodes.some((id) => typeof id !== "string" || !ID.test(id)) || new Set(raw.nodes).size !== raw.nodes.length) fail("invalid_network_nodes", "Network requires 2–16 distinct node entity IDs");
  if (typeof raw.referenceNode !== "string" || !raw.nodes.includes(raw.referenceNode)) fail("invalid_network_reference", "Reference node must be explicitly supplied");
  for (const id of raw.nodes) {
    const entity = problem.entities.find((candidate) => candidate.id === id);
    if (!entity || entity.kind !== "point" || entity.evidenceFactIds.length === 0) fail("ungrounded_network", `Node ${id} requires a grounded point entity`);
    entity.evidenceFactIds.forEach((factId) => sourceFact(problem, factId));
  }
  const nodeNames = raw.nodes.map((id) => problem.entities.find((entity) => entity.id === id)?.label ?? id);
  if (new Set(nodeNames).size !== nodeNames.length) fail("ambiguous_network_owner", "Distinct physical nodes cannot alias the same source name");
  const declaredNodes = assertions.find((item) => item.kind === "nodes" || item.kind === "header")!.names;
  if (new Set(declaredNodes).size !== declaredNodes.length || declaredNodes.length !== nodeNames.length || declaredNodes.some((name) => !nodeNames.includes(name))) fail("source_topology_mismatch", "Every source-declared node must match exactly one network node");
  if (assertions.some((item) => item.kind === "connection" && item.names.slice(1).some((name) => !declaredNodes.includes(name)) || item.kind === "reference" && !declaredNodes.includes(item.names[0]))) fail("source_topology_mismatch", "Every source endpoint, exclusion and voltage reference requires its declared node");
  if (assertions.filter((item) => item.kind === "reference").length > 1) fail("unsupported_source_context", "Multiple absolute voltage references require an unsupported model reconciliation");
  if (Object.hasOwn(raw, "referenceFactId")) {
    if (typeof raw.referenceFactId !== "string") fail("invalid_network_reference", "Source voltage reference requires an explicit fact ID");
    const referenceFact = sourceFact(problem, raw.referenceFactId);
    const referenceName = problem.entities.find((entity) => entity.id === raw.referenceNode)?.label ?? raw.referenceNode;
    if (referenceFact.evidence.quote.replace(/\s+/g, "") !== `V(${referenceName})=0V`) fail("invalid_network_reference", "A source voltage reference must explicitly declare its zero potential");
  }
  if (!Array.isArray(raw.branches) || raw.branches.length < 1 || raw.branches.length > 32) fail("network_capacity", "Network requires 1–32 branches");
  const ids = new Set<string>();
  const componentNames = new Set<string>();
  for (const branch of raw.branches) {
    if (!record(branch)) fail("invalid_network_input", "Branch must be an object");
    keys(branch, ["id", "kind", "from", "to", "connectionConstraintId", "lawFactId", "quantityExpressionId", "quantityFactId", "unit"], ["id", "kind", "from", "to", "connectionConstraintId", "lawFactId"]);
    if (typeof branch.id !== "string" || !ID.test(branch.id) || ids.has(branch.id)) fail("invalid_network_branch", "Branch IDs must be distinct entity IDs");
    ids.add(branch.id);
    if (!["resistor", "voltage_source", "current_source", "wire", "open"].includes(String(branch.kind))) fail("invalid_network_branch", "Unsupported DC element law");
    if (!raw.nodes.includes(branch.from) || !raw.nodes.includes(branch.to) || branch.from === branch.to) fail("invalid_network_topology", "Branch endpoints must be distinct declared nodes");
    const entity = problem.entities.find((candidate) => candidate.id === branch.id);
    if (!entity || entity.kind !== "component" || entity.evidenceFactIds.length === 0) fail("ungrounded_network", "Each branch requires a grounded component entity");
    entity.evidenceFactIds.forEach((factId) => sourceFact(problem, factId));
    const connection = problem.constraints.find((candidate) => candidate.id === branch.connectionConstraintId);
    if (!connection || connection.kind !== "connected" || connection.entityIds.length !== 3 || new Set(connection.entityIds).size !== 3 || ![branch.id, branch.from, branch.to].every((id) => connection.entityIds.includes(String(id))) || connection.evidenceFactIds.length === 0) fail("invalid_network_topology", "Branch endpoints must match an explicit component/node connectivity constraint");
    const sourceName = (id: unknown) => problem.entities.find((candidate) => candidate.id === id)?.label ?? String(id);
    const componentName = sourceName(branch.id);
    if (componentNames.has(componentName)) fail("ambiguous_network_owner", "Distinct components cannot alias the same source name");
    componentNames.add(componentName);
    const endpointFrom = sourceName(branch.from);
    const endpointTo = sourceName(branch.to);
    const prefixes = branch.kind === "resistor" ? ["", "Component ", "Resistor "] : branch.kind === "wire" ? ["", "Component ", "Wire "] : branch.kind === "open" ? ["", "Component ", "Switch "] : ["", "Component ", "Source "];
    const positiveRelations = prefixes.flatMap((prefix) => [
      `${prefix}${componentName} connects ${endpointFrom} to ${endpointTo}`,
      `${prefix}${componentName} connects ${endpointTo} to ${endpointFrom}`,
    ]);
    for (const factId of connection.evidenceFactIds) {
      const fact = sourceFact(problem, factId, assertions);
      const context = sourceAssertion(assertions, fact.evidence.start, fact.evidence.end)!;
      if (context.kind !== "connection") fail("source_topology_mismatch", "A source connection requires a typed affirmative connectivity assertion");
      usedConnections.add(context.start);
      const quote = fact.evidence.quote.replace(/\s+/g, " ").trim();
      if (!positiveRelations.includes(quote)) fail("source_topology_mismatch", "Connectivity requires an explicit affirmative component/endpoint relation; names, excluded endpoints and unsupported clauses are not a topology witness");
    }
    if (typeof branch.lawFactId !== "string") fail("ungrounded_network", "Each branch requires its explicit source constitutive law");
    const lawFact = sourceFact(problem, branch.lawFactId, assertions);
    const quotedLawContext = sourceAssertion(assertions, lawFact.evidence.start, lawFact.evidence.end)!;
    const law = lawFact.evidence.quote.replace(/\s+/g, "");
    const lawContext = assertions.find((item) => item.kind === "law" && item.owner === componentName && problem.question.slice(item.start, item.end).replace(/\s+/g, "") === law);
    if (quotedLawContext.kind !== "law" || !lawContext) fail("source_law_mismatch", "Each law requires its complete named-component assertion context");
    usedLaws.add(lawContext.start);
    const fromName = sourceName(branch.from);
    const toName = sourceName(branch.to);
    const quantityQuote = typeof branch.quantityFactId === "string" ? sourceFact(problem, branch.quantityFactId).evidence.quote.replace(/\s+/g, "") : "";
    const expectedLaw = branch.kind === "resistor" ? `${sourceName(branch.id)}=${quantityQuote}` : branch.kind === "voltage_source" ? `V(${fromName})-V(${toName})=${quantityQuote}` : branch.kind === "current_source" ? `I(${fromName}->${toName})=${quantityQuote}` : branch.kind === "wire" ? `V(${fromName})-V(${toName})=0V` : `I(${fromName}->${toName})=0A`;
    if (law !== expectedLaw) fail("source_law_mismatch", "Branch law, source value and reference direction must agree with the explicit question equation");
    if (branch.kind === "wire" || branch.kind === "open") {
      if (branch.quantityExpressionId !== undefined || branch.quantityFactId !== undefined || branch.unit !== undefined) fail("invalid_network_branch", "Wires/open branches cannot supply a fabricated quantity");
    } else {
      quantity(problem, branch as unknown as DcBranch);
    }
  }
  const sourceConnections = assertions.filter((item) => item.kind === "connection");
  const sourceLaws = assertions.filter((item) => item.kind === "law");
  if (usedConnections.size !== raw.branches.length || usedLaws.size !== raw.branches.length || sourceConnections.length !== usedConnections.size || sourceLaws.length !== usedLaws.size || sourceConnections.some((item) => !usedConnections.has(item.start)) || sourceLaws.some((item) => !usedLaws.has(item.start))) fail("source_topology_mismatch", "A network must account for every source connection and law; ignored, duplicate or conflicting declarations cannot confer authority");
  if (raw.nodes.length - 1 + raw.branches.filter((branch) => branch.kind === "voltage_source" || branch.kind === "wire").length > 32) fail("network_capacity", "Modified nodal system exceeds 32 unknowns");
  return raw as unknown as DcNetwork;
}

function quantity(problem: ProblemIR, branch: DcBranch): Rational {
  if (!["quantityFactId", "quantityExpressionId", "unit"].every((key) => Object.hasOwn(branch, key)) || !branch.quantityFactId || !branch.quantityExpressionId || !branch.unit) fail("ungrounded_network", "Each nontrivial branch requires a source quantity, expression and unit");
  const fact = sourceFact(problem, branch.quantityFactId);
  if (fact.kind !== "given") fail("ungrounded_network", "Branch values must be given, not requested or assumed");
  const unit = UNITS[branch.unit];
  if (!unit || unit.dimension !== branch.kind) fail("invalid_network_unit", "Quantity unit must match the typed element law, with case preserved");
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s+([^\s]+)$/.exec(fact.evidence.quote.trim());
  if (!match || match[2] !== branch.unit) fail("invalid_source_quantity", "Quantity fact must quote its complete numeric literal and matching unit");
  const coefficient = decimal(match[1]);
  const value = mul(coefficient, decimal(unit.factor));
  const expression = problem.expressions.find((candidate) => candidate.id === branch.quantityExpressionId);
  if (!expression || !["root", "valueType", "evidenceFactIds"].every((key) => Object.hasOwn(expression, key)) || expression.valueType !== "scalar" || !Object.hasOwn(expression.root, "kind") || !Object.hasOwn(expression.root, "value") || expression.root.kind !== "number" || expression.root.value !== bounded(value).approximate || !expression.evidenceFactIds.includes(fact.id)) fail("source_quantity_mismatch", "Typed SI scalar must match its exact supplied quantity fact");
  const entity = problem.entities.find((candidate) => candidate.id === branch.id);
  if (!entity?.evidenceFactIds.includes(fact.id)) fail("ungrounded_network", "Component must cite its own value fact");
  if (branch.kind === "resistor" && value.n <= 0n) fail("invalid_network_resistance", "Resistance must be strictly positive; ideal wires are a separate law");
  return value;
}

export function solveDcNetwork(problem: ProblemIR, raw: unknown): DcNetworkSolution {
  const network = validateDcNetwork(problem, raw);
  const nodes = [...network.nodes].filter((id) => id !== network.referenceNode).sort();
  const branches = [...network.branches].sort((a, b) => a.id.localeCompare(b.id));
  const voltageBranches = branches.filter((branch) => branch.kind === "voltage_source" || branch.kind === "wire");
  const dimension = nodes.length + voltageBranches.length;
  const rows = Array.from({ length: dimension }, () => Array.from({ length: dimension + 1 }, () => ZERO));
  const indices = new Map(nodes.map((id, index) => [id, index]));
  const values = new Map(branches.map((branch) => [branch.id, branch.kind === "wire" || branch.kind === "open" ? ZERO : quantity(problem, branch)]));
  const stamp = (row: number | undefined, column: number | undefined, value: Rational) => {
    if (row !== undefined && column !== undefined) rows[row][column] = add(rows[row][column], value);
  };
  for (const branch of branches) {
    const from = indices.get(branch.from);
    const to = indices.get(branch.to);
    const value = values.get(branch.id)!;
    if (branch.kind === "resistor") {
      const conductance = div(ONE, value);
      stamp(from, from, conductance); stamp(to, to, conductance);
      stamp(from, to, neg(conductance)); stamp(to, from, neg(conductance));
    } else if (branch.kind === "current_source") {
      stamp(from, dimension, neg(value)); stamp(to, dimension, value);
    } else if (branch.kind === "voltage_source" || branch.kind === "wire") {
      const index = nodes.length + voltageBranches.indexOf(branch);
      stamp(from, index, ONE); stamp(to, index, neg(ONE));
      stamp(index, from, ONE); stamp(index, to, neg(ONE));
      stamp(index, dimension, value);
    }
  }
  let rank = 0;
  for (let column = 0; column < dimension; column += 1) {
    const pivot = rows.findIndex((row, index) => index >= rank && row[column].n !== 0n);
    if (pivot < 0) continue;
    [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]];
    const divisor = rows[rank][column];
    rows[rank] = rows[rank].map((value) => div(value, divisor));
    for (let index = 0; index < dimension; index += 1) {
      if (index === rank || rows[index][column].n === 0n) continue;
      const factor = rows[index][column];
      rows[index] = rows[index].map((value, position) => sub(value, mul(factor, rows[rank][position])));
    }
    rank += 1;
  }
  if (rows.some((row) => row.slice(0, dimension).every((value) => value.n === 0n) && row[dimension].n !== 0n)) fail("incompatible_network", "Source laws and supplied connections are incompatible");
  if (rank !== dimension) fail("underdetermined_network", "Floating nodes or ideal-source/wire loops do not determine every voltage and branch current");
  const potentials = new Map([[network.referenceNode, ZERO], ...nodes.map((id, index): [string, Rational] => [id, rows[index][dimension]])]);
  const currents = new Map<string, Rational>();
  const balances = new Map(network.nodes.map((id) => [id, ZERO]));
  let power = ZERO;
  for (const branch of branches) {
    const drop = sub(potentials.get(branch.from)!, potentials.get(branch.to)!);
    const value = values.get(branch.id)!;
    const current = branch.kind === "resistor" ? div(drop, value) : branch.kind === "current_source" ? value : branch.kind === "open" ? ZERO : rows[nodes.length + voltageBranches.indexOf(branch)][dimension];
    if ((branch.kind === "voltage_source" || branch.kind === "wire") && sub(drop, value).n !== 0n) fail("network_law_failure", "Voltage-source law failed exact substitution");
    currents.set(branch.id, current);
    balances.set(branch.from, add(balances.get(branch.from)!, current));
    balances.set(branch.to, sub(balances.get(branch.to)!, current));
    power = add(power, mul(drop, current));
  }
  if ([...balances.values()].some((value) => value.n !== 0n) || power.n !== 0n) fail("network_law_failure", "KCL or signed power conservation failed exact substitution");
  return {
    referenceNode: network.referenceNode,
    voltages: Object.fromEntries([...potentials].sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => [id, bounded(value)])),
    currents: Object.fromEntries([...currents].map(([id, value]) => [id, bounded(value)])),
    expressionIds: [...new Set(branches.flatMap((branch) => branch.quantityExpressionId ? [branch.quantityExpressionId] : []))].sort(),
    residual: 0,
    lawChecks: network.nodes.length + branches.length + 1,
  };
}

export function dcNetworkValue(solution: DcNetworkSolution, raw: unknown): DcExactValue {
  if (!record(raw)) fail("invalid_network_output", "A requested node voltage or oriented branch current is required");
  keys(raw, ["kind", "id"], ["kind", "id"]);
  if (typeof raw.id !== "string" || !["node_voltage", "branch_current"].includes(String(raw.kind))) fail("invalid_network_output", "Invalid requested network scalar");
  const values = raw.kind === "node_voltage" ? solution.voltages : solution.currents;
  if (!Object.hasOwn(values, raw.id)) fail("invalid_network_output", "Requested network owner is not declared");
  return values[raw.id];
}
