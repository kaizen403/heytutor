/** PRIVATE bounded source closure. No admission/presentation consumer. */
import * as e from "./neutralComparisonDependencies";

export interface SourceArgument {
  readonly start: number; readonly end: number; readonly text: string;
}
export interface ComparisonSpecies {
  readonly source: SourceArgument;
  readonly sourceIdentity: string;
  readonly graphIdentity: string;
  readonly resolved: NonNullable<ReturnType<typeof e.resolveChemistryStructure>>;
}
export interface ComparisonClosure {
  readonly ok: boolean;
  readonly schema: "comparison" | "formula-relationship" | "named-test" | null;
  readonly arguments: readonly SourceArgument[];
  readonly species: readonly ComparisonSpecies[];
  readonly physicalReadings: readonly e.ChemistryReading[];
  readonly issues: readonly string[];
}

/** Denial-only subject evidence for a failed whole request. The existing subject
 * decision cannot admit or normalize a request; a lone formula cannot override it. */
export function failedChemistryComparisonRequest(question: string, closure: ComparisonClosure): boolean {
  if (!closure.schema && !/^\s*Compare\b/i.test(question)) return false;
  return e.isChemistryStem(question);
}

// This is the existing F3 domain inventory, not a new number/unit parser.
const dimensions: readonly e.ChemistryDimension[] = [
  "dimensionless", "time", "temperature", "temperature_delta", "length", "volume", "mass", "amount",
  "molar_mass", "density", "concentration", "normality", "molality", "pressure", "energy", "molar_energy",
  "entropy", "molar_entropy", "heat_capacity", "molar_heat_capacity", "frequency", "speed", "momentum",
  "action", "energy_length", "potential", "current", "charge", "faraday_constant", "avogadro_constant",
  "gas_constant", "rate_constant_first", "rate_constant_zero", "rate_constant_second", "colligative_constant",
  "concentration_pressure",
];

export function supportedGraph(species: ComparisonSpecies): boolean {
  const m = species.resolved.molecule;
  if (!m || m.stereo || m.formulaOverride || m.atoms.length < 2 || m.atoms.length > 16 || m.bonds.length !== m.atoms.length - 1) return false;
  if (m.atoms.some((a, i) => a.index !== i || !["C", "O"].includes(a.element) || a.charge !== 0 || a.aromatic || a.explicitH)) return false;
  if (m.bonds.some((b, i) => b.index !== i || b.aromatic || b.direction || ![1, 2].includes(b.order) || b.a === b.b || !m.atoms[b.a] || !m.atoms[b.b])) return false;
  const reached = new Set([0]);
  for (let i = 0; i < m.atoms.length; i++) for (const b of m.bonds) {
    if (reached.has(b.a)) reached.add(b.b);
    if (reached.has(b.b)) reached.add(b.a);
  }
  if (reached.size !== m.atoms.length) return false;
  const edges = new Set<string>();
  for (const b of m.bonds) {
    const key = [b.a, b.b].sort((a, c) => a - c).join(":");
    if (edges.has(key)) return false;
    edges.add(key);
    const a = m.atoms[b.a]!, c = m.atoms[b.b]!;
    if (a.element === "O" && c.element === "O") return false;
    if (a.element === "C" && c.element === "C" && b.order !== 1) return false;
  }
  for (const a of m.atoms) {
    const incident = m.bonds.filter(b => b.a === a.index || b.b === a.index);
    const hydrogenCount = (a.element === "C" ? 4 : 2) - incident.reduce((n, b) => n + b.order, 0);
    if (!Number.isInteger(hydrogenCount) || hydrogenCount < 0 || a.hydrogens !== hydrogenCount) return false;
    if (a.element === "O" && (incident.length !== 1 || ![0, 1].includes(hydrogenCount))) return false;
  }
  return true;
}

/** Whole request grammar, never a recognized-substring scanner or caller span list. */
export function closeComparisonSource(question: string): ComparisonClosure {
  const issues: string[] = [], species: ComparisonSpecies[] = [];
  let schema: ComparisonClosure["schema"] = null;
  let list = "", start = 0;
  if (question !== question.trim() || question.length > 1000) issues.push("unsupported_request_boundary");
  if (/\b(?:not|never|background|only|except|exclude|instead)\b/i.test(question)) issues.push("unsupported_species_role");
  let match = /^Compare (.+)\.$/i.exec(question);
  if (match) { schema = "comparison"; list = match[1]!; start = match[0].length - list.length - 1; }
  else {
    match = /^(.+) have the same molecular formula\. Are they (?:homologues|isomers)\? Name the relationship and the functional group of each\.$/i.exec(question);
    if (match) { schema = "formula-relationship"; list = match[1]!; }
    else {
      match = /^How does ([A-Za-z]+(?: [A-Za-z]+){0,3} test) distinguish between (.+)\? State what is observed with each and why\.$/i.exec(question);
      if (match) { schema = "named-test"; list = match[2]!; start = question.indexOf(" distinguish between ") + " distinguish between ".length; }
    }
  }
  if (!schema) issues.push("unsupported_complete_request");
  const args: SourceArgument[] = [];
  if (schema) {
    let cursor = 0;
    for (const separator of list.matchAll(/\s+and\s+|,\s+(?:and\s+)?/g)) {
      const end = separator.index;
      args.push({ start: start + cursor, end: start + end, text: list.slice(cursor, end) });
      cursor = end + separator[0].length;
    }
    args.push({ start: start + cursor, end: start + list.length, text: list.slice(cursor) });
    if (args.length < 2 || args.length > 4) issues.push("unsupported_complete_list_cardinality");
    for (const source of args) {
      if (!/^[\p{L}\d-]+(?:,\d+-[\p{L}\d-]+)*(?: [\p{L}\d-]+)*$/u.test(source.text) || source.text !== source.text.trim()) {
        issues.push(`unsupported_complete_argument:${source.text}`); continue;
      }
      const identity = e.chemistrySpeciesIdentity(source.text);
      const resolved = e.resolveChemistryStructure(question.slice(source.start, source.end), "organic");
      if (!identity || !e.checkedChemistrySourceIdentity(question, source, identity.key) || !resolved?.molecule) {
        issues.push(`unresolved_complete_argument:${source.text}`); continue;
      }
      const s: ComparisonSpecies = { source, sourceIdentity: identity.key, graphIdentity: resolved.identityKey, resolved };
      if (!supportedGraph(s)) { issues.push(`unsupported_source_graph:${source.text}`); continue; }
      species.push(s);
    }
    if (species.length !== args.length) issues.push("incomplete_requested_species_coverage");
    if (new Set(args.map(a => a.text.toLowerCase())).size !== args.length) issues.push("duplicate_requested_argument");
    if (schema === "formula-relationship" && new Set(species.map(s => s.resolved.formulaKey)).size !== 1) issues.push("source_formula_assertion_conflict");
  }
  const physicalReadings: e.ChemistryReading[] = [];
  for (const dimension of dimensions) {
    const reads = e.findChemistryQuantities({ question, dimension });
    if (!reads.ok) { if (reads.code !== "missing") issues.push(`unsupported_physical_read:${dimension}:${reads.code}`); continue; }
    for (const read of reads.reading) {
      // Original structural spans have been completely resolved with valence/H
      // checks. Counts/locants within those spans never grant physical authority.
      if (species.some(s => s.source.start <= read.source.span.start && s.source.end >= read.source.span.end)) continue;
      physicalReadings.push(read);
    }
  }
  if (physicalReadings.length) issues.push("unsupported_source_physical_authority");
  return { ok: issues.length === 0, schema, arguments: args, species, physicalReadings, issues: [...new Set(issues)] };
}
