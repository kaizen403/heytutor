import { chemistryCountSourceClause } from "./structuralClauses";
import type { SceneDocument } from "../../types";
import type { LewisResult } from "../lewis";
import { vseprBondInkPlan, type VseprResult } from "../vsepr";
import type { RenderedChemistryBond } from "./bondInk";
import { CHEMISTRY_REPRESENTATION_VERSION, type ChemistryRepresentation, type ChemistryRepresentationDocument, type ChemistrySourceSpan, type ChemistrySpeciesBinding, type ChemistryStructuralRule } from "./types";
import { checkedChemistrySourceIdentity, chemistrySpeciesIdentity, resolveChemistryStructure, sameOrganicGraph } from "./species";
import { auditChemistryRepresentation } from "./audit";

/** Find a complete original species with the independently resolved identity. */
export function findChemistrySourceSpan(question: string, text: string): ChemistrySourceSpan | null {
  const wanted = chemistrySpeciesIdentity(text);
  if (!wanted) return null;
  for (let start = 0; start < question.length; start += 1) {
    for (let end = start + 1; end <= Math.min(question.length, start + text.length * 2 + 16); end += 1) {
      const source = { start, end, text: question.slice(start, end) };
      if (checkedChemistrySourceIdentity(question, source, wanted.key)) return source;
    }
  }
  return null;
}

export function withChemistryRepresentation(document: SceneDocument, species: ChemistrySpeciesBinding[]): ChemistryRepresentationDocument | null {
  const question = String(document.source.question ?? "");
  const metadata: ChemistryRepresentation = {
    version: CHEMISTRY_REPRESENTATION_VERSION, species,
    structuralEntityIds: species.flatMap((binding) => binding.entityIds), structuralQuantities: [], structuralTexts: [],
  };
  const result: ChemistryRepresentationDocument = { ...document, source: { ...document.source, chemistryRepresentation: metadata }, entities: document.entities.map((e) => ({ ...e, provenance: { ...e.provenance } })) };
  for (const binding of species) {
    const resolved = resolveChemistryStructure(binding.source.text, binding.resolver);
    if (!resolved) return null;
    for (const node of binding.nodes) {
      const expected = resolved.nodes.find((n) => n.key === node.nodeKey);
      for (const id of [expected?.label !== null ? node.entityId : "", node.chargeEntityId ?? ""].filter(Boolean)) {
        const entity = result.entities.find((e) => e.id === id);
        if (entity) entity.provenance = { ...entity.provenance, chemistryRepresentation: { version: CHEMISTRY_REPRESENTATION_VERSION, role: "structure_symbol" } };
      }
    }
    const matchesSpecies = (text: string): boolean => {
      const identity = chemistrySpeciesIdentity(text);
      return identity !== null && (identity.key === resolved.identityKey || (identity.kind === "formula" && identity.key === `formula:${resolved.formulaKey}`) || (identity.molecule !== undefined && resolved.molecule !== undefined && sameOrganicGraph(identity.molecule, resolved.molecule)));
    };
    const addText = (owner: "entity" | "annotation", ownerId: string, text: string): void => {
      if (matchesSpecies(text)) metadata.structuralTexts.push({ owner, ownerId, start: 0, end: text.length, speciesKey: binding.speciesKey, rule: "species" });
      else for (const token of text.matchAll(/[^\s,:;]+/g)) if (matchesSpecies(token[0])) metadata.structuralTexts.push({ owner, ownerId, start: token.index!, end: token.index! + token[0].length, speciesKey: binding.speciesKey, rule: "species" });
      const labels: Array<[ChemistryStructuralRule, RegExp]> = [
        ["sigma_bonds", /(?:σ|sigma(?: bonds?)?)\s*=\s*([+-]?\d+)(?=\s*(?:[,;]|$))/giu],
        ["pi_bonds", /(?:π|pi(?: bonds?)?)\s*=\s*([+-]?\d+)(?=\s*(?:[,;]|$))/giu],
        ["lone_pairs", /lone\s+pairs?\s*=\s*([+-]?\d+)(?=\s*(?:[,;]|$))/giu],
      ];
      // Multi-species summaries need an explicit complete species clause;
      // the audit independently repeats ownership before masking the count.
      for (const [rule, pattern] of labels) for (const token of text.matchAll(pattern)) {
        const literal = token[1]!; const start = token.index! + token[0].lastIndexOf(literal);
        const clause = chemistryCountSourceClause(text, start);
        if (species.length > 1 && (!clause || !matchesSpecies(clause.text))) continue;
        metadata.structuralTexts.push({ owner, ownerId, start, end: start + literal.length, speciesKey: binding.speciesKey, rule });
      }
    };
    for (const entity of document.entities) if (typeof entity.label === "string") addText("entity", entity.id, entity.label);
    for (const annotation of document.annotations) if (typeof annotation.text === "string") addText("annotation", annotation.id, annotation.text);
  }
  const audit = auditChemistryRepresentation(result, question);
  return audit.issues.length === 0 ? result : null;
}

export function bindLewisRepresentation(document: SceneDocument, inputs: Array<{ sourceText: string; prefix: string; result: LewisResult }>): ChemistryRepresentationDocument | null {
  const question = String(document.source.question ?? "");
  const species: ChemistrySpeciesBinding[] = [];
  for (const [index, input] of inputs.entries()) {
    const source = findChemistrySourceSpan(question, input.sourceText);
    if (!source) return null;
    const resolved = resolveChemistryStructure(source.text, "lewis");
    if (!resolved) return null;
    const nodes = input.result.atoms.map((atom) => ({
      nodeKey: atom.id, entityId: `${input.prefix}${atom.id}`,
      ...(atom.formalCharge ? { chargeEntityId: `${input.prefix}fc_${atom.id}` } : {}),
      electronEntityIds: Array.from({ length: atom.lonePairs }, (_, pair) => [1, 2].map((electron) => `${input.prefix}lp_${atom.id}_${pair + 1}_${electron}`)).flat().concat(atom.unpaired ? [`${input.prefix}odd_${atom.id}`] : []),
    }));
    const bonds = input.result.bonds.map((bond) => ({ a: bond.a, b: bond.b, entityIds: bond.order === 1 ? [`${input.prefix}b_${bond.id}`] : Array.from({ length: bond.order }, (_, stroke) => `${input.prefix}b_${bond.id}_${stroke + 1}`) }));
    species.push({ speciesKey: `species_${index + 1}`, source, resolver: "lewis", identityKey: resolved.identityKey, nodes, bonds, entityIds: [...nodes.flatMap((n) => [n.entityId, ...n.electronEntityIds, ...(n.chargeEntityId ? [n.chargeEntityId] : [])]), ...bonds.flatMap((b) => b.entityIds)] });
  }
  const bound = withChemistryRepresentation(document, species);
  if (!bound) return null;
  // Existing Lewis scalar summaries are for the first drawn species only.
  for (const rule of ["sigma_bonds", "pi_bonds", "lone_pairs"] as const) if (bound.quantities.some((q) => q.id === rule)) bound.source.chemistryRepresentation.structuralQuantities.push({ quantityId: rule, speciesKey: "species_1", rule });
  return auditChemistryRepresentation(bound, question).issues.length === 0 ? bound : null;
}

export function bindVseprRepresentation(document: SceneDocument, inputs: Array<{ sourceText: string; prefix: string; result: VseprResult; bondInk?: RenderedChemistryBond[] }>): ChemistryRepresentationDocument | null {
  const question = String(document.source.question ?? "");
  const species: ChemistrySpeciesBinding[] = [];
  for (const [index, input] of inputs.entries()) {
    const source = findChemistrySourceSpan(question, input.sourceText);
    if (!source) return null;
    const resolved = resolveChemistryStructure(source.text, "vsepr");
    if (!resolved) return null;
    const inkPlan = vseprBondInkPlan(input.result);
    if (!inkPlan || inkPlan.length !== resolved.nodes.length - 1 || (input.bondInk && input.bondInk.length !== inkPlan.length)) return null;
    const available = [...resolved.nodes.slice(1)];
    const nodes = [{ nodeKey: "central", entityId: `${input.prefix}_A`, electronEntityIds: document.entities.filter((e) => e.id.startsWith(`${input.prefix}_lp`) && e.kind === "point" && !e.role.includes("helper")).map((e) => e.id).concat(input.result.unpairedElectron ? [`${input.prefix}_odd`] : []) }];
    const bonds: ChemistrySpeciesBinding["bonds"] = [];
    for (let ligand = 1; ligand < resolved.nodes.length; ligand += 1) {
      const id = `${input.prefix}_L${ligand}`;
      const entity = document.entities.find((e) => e.id === id);
      const wanted = available.findIndex((n) => n.label === entity?.label);
      if (wanted < 0) return null;
      const node = available.splice(wanted, 1)[0]!;
      nodes.push({ nodeKey: node.key, entityId: id, electronEntityIds: [] });
      const operator = inkPlan[ligand - 1]!;
      if (operator.ligandLabel !== entity?.label) return null;
      const rendered = input.bondInk?.[ligand - 1];
      if (rendered && rendered.ligandEntityId !== id) return null;
      const entityIds = rendered?.entityIds ?? (operator.strokeCount === 1 ? [`${input.prefix}_b${ligand}`] : Array.from({ length: operator.strokeCount }, (_, stroke) => `${input.prefix}_b${ligand}_${stroke + 1}`));
      bonds.push({ a: "central", b: node.key, entityIds: [...entityIds] });
    }
    species.push({ speciesKey: `species_${index + 1}`, source, resolver: "vsepr", identityKey: resolved.identityKey, nodes, bonds, entityIds: [...nodes.flatMap((n) => [n.entityId, ...n.electronEntityIds]), ...bonds.flatMap((b) => b.entityIds)] });
  }
  return withChemistryRepresentation(document, species);
}

/** Complete, explicit acyclic graphs only. Collapsed groups/aromatic shorthand
 * need an adapter that proves those drawing operators before gaining a role. */
export function bindOrganicRepresentation(document: SceneDocument, inputs: Array<{ sourceText: string; prefix: string }>): ChemistryRepresentationDocument | null {
  const question = String(document.source.question ?? "");
  const species: ChemistrySpeciesBinding[] = [];
  for (const [index, input] of inputs.entries()) {
    const source = findChemistrySourceSpan(question, input.sourceText);
    if (!source) return null;
    const resolved = resolveChemistryStructure(source.text, "organic");
    const molecule = resolved?.molecule;
    if (!resolved || !molecule || molecule.atoms.some((a) => a.aromatic)) return null;
    const nodes = molecule.atoms.map((atom) => ({ nodeKey: `a${atom.index}`, entityId: `${input.prefix}_a${atom.index}`, electronEntityIds: [] }));
    const bonds = molecule.bonds.map((bond) => ({ a: `a${bond.a}`, b: `a${bond.b}`, entityIds: bond.order === 1 ? [`${input.prefix}_b${bond.index}`] : Array.from({ length: bond.order }, (_, stroke) => `${input.prefix}_b${bond.index}_${stroke + 1}`) }));
    species.push({ speciesKey: `species_${index + 1}`, source, resolver: "organic", identityKey: resolved.identityKey, nodes, bonds, entityIds: [...nodes.map((n) => n.entityId), ...bonds.flatMap((b) => b.entityIds)] });
  }
  return withChemistryRepresentation(document, species);
}
