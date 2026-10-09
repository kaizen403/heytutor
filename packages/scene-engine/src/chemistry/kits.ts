import type {
  SceneDocument,
  SceneIssue,
} from "../types";
import { parseFormula } from "./formula";
import { buildLewisSceneForFormula, lewisStructure } from "./lewis";
import { buildSkeletalMoleculeScene, moleculeFromName } from "./organic";
import { heavyAtomCount, parseSmiles } from "./organic/smiles";
import { buildReactionEnergyProfileScene } from "./thermoGraphs";
import { buildVseprSceneForFormula, vseprGeometry } from "./vsepr";
import { electronConfiguration } from "./electronConfiguration";
import { buildOrbitalBoxScene, type OrbitalBoxSpeciesInput } from "./orbitalBox";
import { elementByZ } from "./elements";

export const CHEMISTRY_KIT_OPERATORS = [
  "chem_skeletal_molecule",
  "chem_lewis_structure",
  "chem_vsepr_shape",
  "chem_reaction_energy_profile",
  "chem_orbital_boxes",
] as const;

export type ChemistryKitOperator = (typeof CHEMISTRY_KIT_OPERATORS)[number];

const CHEMISTRY_KIT_OPERATOR_SET = new Set<string>(CHEMISTRY_KIT_OPERATORS);

export function isChemistryKitOperator(value: string): value is ChemistryKitOperator {
  return CHEMISTRY_KIT_OPERATOR_SET.has(value);
}

export interface ChemistryKitExpansionResult {
  readonly document: SceneDocument | null;
  readonly issues: SceneIssue[];
}

interface QuantityRecord {
  readonly id: string;
  readonly value: number;
  readonly unit: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return nonemptyString(value, field);
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

function optionalCharge(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || Math.abs(value) > 4) {
    throw new Error("charge must be an integer from -4 to 4");
  }
  return value;
}

function formulaWithCharge(formulaInput: unknown, chargeInput: unknown): string {
  const formula = nonemptyString(formulaInput, "formula");
  const parsed = parseFormula(formula);
  if (!parsed) throw new Error(`formula ${formula} is not supported`);
  const charge = optionalCharge(chargeInput);
  if (charge === undefined) return formula;
  if (parsed.charge !== 0 && parsed.charge !== charge) {
    throw new Error(`charge ${charge} conflicts with the charge ${parsed.charge} written in ${formula}`);
  }
  if (parsed.charge !== 0 || charge === 0) return formula;
  return `${formula}^(${Math.abs(charge) > 1 ? Math.abs(charge) : ""}${charge < 0 ? "-" : "+"})`;
}

function canonicalEnergyUnit(unit: string): string | null {
  switch (unit.trim().toLowerCase().replace(/\s+/g, "")) {
    case "kj":
    case "kj/mol":
    case "kjmol-1":
    case "kjmol−1": return "kJ";
    case "j":
    case "j/mol":
    case "jmol-1":
    case "jmol−1": return "J";
    case "kcal":
    case "kcal/mol":
    case "kcalmol-1":
    case "kcalmol−1": return "kcal";
    case "ev": return "eV";
    default: return null;
  }
}

function quantitiesFrom(raw: Record<string, unknown>): QuantityRecord[] {
  if (!Array.isArray(raw.quantities)) return [];
  return raw.quantities.flatMap((quantity) => {
    if (
      !isRecord(quantity) ||
      typeof quantity.id !== "string" ||
      typeof quantity.value !== "number" ||
      !Number.isFinite(quantity.value) ||
      typeof quantity.unit !== "string"
    ) return [];
    return [{ id: quantity.id, value: quantity.value, unit: quantity.unit }];
  });
}

function requiredQuantity(
  quantities: readonly QuantityRecord[],
  idInput: unknown,
  field: string,
): QuantityRecord {
  const id = nonemptyString(idInput, field);
  const quantity = quantities.find((candidate) => candidate.id === id);
  if (!quantity) throw new Error(`${field} ${id} does not name a finite plan quantity with a unit`);
  if (!canonicalEnergyUnit(quantity.unit)) throw new Error(`${field} ${id} must use an energy unit`);
  return quantity;
}

function prefixValue(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => prefixValue(item, ids));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, prefixValue(item, ids)]));
}

function collectStringRefs(value: unknown, refs: Set<string>): void {
  if (typeof value === "string") refs.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStringRefs(item, refs));
  else if (isRecord(value)) Object.values(value).forEach((item) => collectStringRefs(item, refs));
}

function prefixDocument(document: SceneDocument, prefix: string): SceneDocument {
  const referenced = new Set(document.requiredEntityIds);
  document.constructions.forEach((construction) => collectStringRefs(construction.inputs, referenced));
  document.relations.forEach((relation) => collectStringRefs(relation.entities, referenced));
  document.assertions.forEach((assertion) => collectStringRefs(assertion.entities, referenced));
  document.annotations.forEach((annotation) => collectStringRefs(annotation.targetIds, referenced));
  const retainedEntities = document.entities.filter((entity) => referenced.has(entity.id));
  const retainedConstructions = document.constructions.filter((construction) =>
    construction.outputs.some((output) => referenced.has(output)));
  const ids = new Map<string, string>();
  const idCollections = [
    retainedEntities,
    retainedConstructions,
    document.relations,
    document.assertions,
    document.annotations,
    document.revealGroups,
    document.teachingTimeline,
  ];
  for (const collection of idCollections) {
    for (const item of collection) ids.set(item.id, `${prefix}__${item.id}`);
  }
  return {
    ...document,
    // SceneBuilder keeps construction anchors as point declarations with
    // chemistry roles (for example an unlabelled skeletal C). Mark only the
    // non-required declarations as generic helpers so strict validation keeps
    // them solver-only rather than turning a carbon vertex into a visible dot.
    entities: retainedEntities.map((entity) => ({
      ...entity,
      id: ids.get(entity.id)!,
      ...(!document.requiredEntityIds.includes(entity.id) ? { role: "construction helper" } : {}),
    })),
    constructions: retainedConstructions.map((construction) => ({
      ...construction,
      id: ids.get(construction.id)!,
      inputs: prefixValue(construction.inputs, ids) as Record<string, unknown>,
      outputs: construction.outputs.map((id) => ids.get(id) ?? id),
    })),
    relations: document.relations.map((relation) => ({
      ...relation,
      id: ids.get(relation.id)!,
      entities: relation.entities.map((id) => ids.get(id) ?? id),
    })),
    assertions: document.assertions.map((assertion) => ({
      ...assertion,
      id: ids.get(assertion.id)!,
      entities: assertion.entities.map((id) => ids.get(id) ?? id),
    })),
    annotations: document.annotations.map((annotation) => ({
      ...annotation,
      id: ids.get(annotation.id)!,
      targetIds: annotation.targetIds.map((id) => ids.get(id) ?? id),
    })),
    requiredEntityIds: document.requiredEntityIds.map((id) => ids.get(id) ?? id),
    revealGroups: document.revealGroups.map((group) => ({
      ...group,
      id: ids.get(group.id)!,
      entityIds: group.entityIds.map((id) => ids.get(id) ?? id),
      dependsOn: group.dependsOn.map((id) => ids.get(id) ?? id),
    })),
    teachingTimeline: document.teachingTimeline.map((action) => ({
      ...action,
      id: ids.get(action.id)!,
      targetId: ids.get(action.targetId) ?? action.targetId,
      dependsOn: action.dependsOn.map((id) => ids.get(id) ?? id),
    })),
  };
}

function addCountProof(
  document: SceneDocument,
  id: string,
  entityIds: readonly string[],
  expected: number,
  reason: string,
): void {
  if (entityIds.length !== expected) throw new Error(`${reason}: expected ${expected}, generated ${entityIds.length}`);
  document.assertions.push({ id, predicate: "entity_count", entities: [...entityIds], expected, severity: "fatal", reason });
}

function lewisDocument(question: string, inputs: Record<string, unknown>): SceneDocument {
  const formula = formulaWithCharge(inputs.formula, inputs.charge);
  const resonance = optionalBoolean(inputs.resonance, "resonance") ?? false;
  const result = lewisStructure(formula);
  const document = buildLewisSceneForFormula(question, formula, resonance);
  if (!result || !document) throw new Error(`formula ${formula} cannot produce a verified Lewis structure`);
  const atomIds = document.entities.filter((entity) => / atom$/.test(entity.role)).map((entity) => entity.id);
  const bondIds = document.entities.filter((entity) => /^(?:single|double|triple) bond(?: stroke)?$/.test(entity.role)).map((entity) => entity.id);
  const lonePairIds = document.entities.filter((entity) => entity.role === "lone pair electron").map((entity) => entity.id);
  const renderedForms = resonance && result.resonanceCount > 1 && result.resonanceForms.length > 1
    ? Math.min(3, result.resonanceForms.length)
    : 1;
  addCountProof(document, "kit_atom_count", atomIds, result.atoms.length * renderedForms, "Lewis atom count");
  addCountProof(document, "kit_bond_order_count", bondIds, result.bonds.reduce((sum, bond) => sum + bond.order, 0) * renderedForms, "Lewis bond-order strokes");
  addCountProof(document, "kit_lone_pair_count", lonePairIds, result.lonePairs * 2 * renderedForms, "Lewis lone-pair electrons");
  document.source = {
    ...document.source,
    chemistryKitProof: {
      formula: result.text,
      valenceElectrons: result.totalValenceElectrons,
      atoms: result.atoms.length,
      bonds: result.bonds.length,
      lonePairs: result.lonePairs,
      resonanceForms: result.resonanceCount,
      renderedForms,
    },
  };
  return document;
}

function vseprDocument(question: string, inputs: Record<string, unknown>): SceneDocument {
  const formula = formulaWithCharge(inputs.formula, inputs.charge);
  const result = vseprGeometry(formula);
  const document = buildVseprSceneForFormula(question, formula);
  if (!result || !document) throw new Error(`formula ${formula} cannot produce a verified VSEPR shape`);
  const atomIds = document.entities.filter((entity) => /central atom$| ligand$/.test(entity.role)).map((entity) => entity.id);
  const lonePairIds = document.entities.filter((entity) => entity.role === "lone pair electron").map((entity) => entity.id);
  const expectedElectrons = result.unpairedElectron ? (result.lonePairs - 1) * 2 : result.lonePairs * 2;
  addCountProof(document, "kit_domain_atom_count", atomIds, result.bondPairs + 1, "VSEPR central and ligand atoms");
  addCountProof(document, "kit_lone_pair_count", lonePairIds, expectedElectrons, "VSEPR lone-pair electrons");
  document.source = {
    ...document.source,
    chemistryKitProof: {
      formula: result.formula,
      axe: result.axe,
      stericNumber: result.stericNumber,
      bondPairs: result.bondPairs,
      lonePairs: result.lonePairs,
      shape: result.shape,
    },
  };
  return document;
}

function skeletalDocument(question: string, inputs: Record<string, unknown>): SceneDocument {
  const name = optionalString(inputs.name, "name");
  const smiles = optionalString(inputs.smiles, "smiles");
  if ((name === undefined) === (smiles === undefined)) throw new Error("provide exactly one of name or smiles");
  const molecule = name ? moleculeFromName(name) : parseSmiles(smiles!);
  const document = buildSkeletalMoleculeScene(question, { name, smiles });
  if (!molecule || !document) throw new Error(`${name ?? smiles} cannot produce a verified skeletal structure`);
  const bondIds = document.entities.filter((entity) => entity.role === "bond").map((entity) => entity.id);
  addCountProof(document, "kit_bond_count", bondIds, molecule.bonds.length, "skeletal bond count");
  document.source = {
    ...document.source,
    chemistryKitProof: {
      atomCount: molecule.atoms.length,
      heavyAtomCount: heavyAtomCount(molecule),
      bondCount: molecule.bonds.length,
      bondOrderSum: molecule.bonds.reduce((sum, bond) => sum + bond.order, 0),
    },
  };
  return document;
}

function energyProfileDocument(
  question: string,
  inputs: Record<string, unknown>,
  quantities: readonly QuantityRecord[],
): SceneDocument {
  const activation = requiredQuantity(quantities, inputs.activationEnergyQuantityId, "activationEnergyQuantityId");
  const deltaH = requiredQuantity(quantities, inputs.deltaHQuantityId, "deltaHQuantityId");
  const catalyst = inputs.catalysedActivationEnergyQuantityId === undefined
    ? null
    : requiredQuantity(quantities, inputs.catalysedActivationEnergyQuantityId, "catalysedActivationEnergyQuantityId");
  const unit = canonicalEnergyUnit(activation.unit)!;
  if (canonicalEnergyUnit(deltaH.unit) !== unit || (catalyst && canonicalEnergyUnit(catalyst.unit) !== unit)) {
    throw new Error("reaction energy quantities must use the same unit");
  }
  const document = buildReactionEnergyProfileScene(question, {
    reactants: nonemptyString(inputs.reactants, "reactants"),
    products: nonemptyString(inputs.products, "products"),
    activationEnergy: activation.value,
    deltaH: deltaH.value,
    unit,
    ...(catalyst ? { catalysedActivationEnergy: catalyst.value } : {}),
  });
  if (!document) throw new Error("reaction energy quantities do not define a physically valid profile");
  document.quantities = [];
  document.annotations.push(
    { id: "kit_ea_binding", kind: "label", targetIds: ["ea_dim"], quantityId: activation.id },
    { id: "kit_dh_binding", kind: "label", targetIds: ["dh_dim"], quantityId: deltaH.id },
    ...(catalyst ? [{ id: "kit_catalyst_binding", kind: "label", targetIds: ["ea_cat_dim"], quantityId: catalyst.id }] : []),
  );
  document.source = {
    ...document.source,
    chemistryKitProof: {
      activationEnergyQuantityId: activation.id,
      deltaHQuantityId: deltaH.id,
      ...(catalyst ? { catalysedActivationEnergyQuantityId: catalyst.id } : {}),
    },
  };
  return document;
}

function orbitalBoxesDocument(question: string, inputs: Record<string, unknown>): SceneDocument {
  if (!Array.isArray(inputs.species) || inputs.species.length === 0 || inputs.species.length > 4) {
    throw new Error("species must contain one to four atomic species");
  }
  if (typeof inputs.showMagneticMoment !== "boolean") throw new Error("showMagneticMoment must be a boolean");
  const species: OrbitalBoxSpeciesInput[] = inputs.species.map((item, index) => {
    if (!isRecord(item)) throw new Error(`species[${index}] must be an object`);
    if (typeof item.atomicNumber !== "number" || !Number.isInteger(item.atomicNumber) || !elementByZ(item.atomicNumber)) {
      throw new Error(`species[${index}].atomicNumber must be an integer from 1 to 118`);
    }
    if (typeof item.charge !== "number" || !Number.isInteger(item.charge) || Math.abs(item.charge) > 4) {
      throw new Error(`species[${index}].charge must be an integer from -4 to 4`);
    }
    return { atomicNumber: item.atomicNumber, charge: item.charge };
  });
  const configurations = species.map((input) => electronConfiguration(elementByZ(input.atomicNumber)!, input.charge));
  if (configurations.some((configuration) => configuration === null)) throw new Error("species does not have a supported electron configuration");
  const document = buildOrbitalBoxScene(question, species, inputs.showMagneticMoment);
  if (!document) throw new Error("species cannot produce a verified orbital-box diagram");
  const boxes = document.entities.filter((entity) => entity.role === "orbital box").map((entity) => entity.id);
  const electrons = document.entities.filter((entity) => entity.role === "electron").map((entity) => entity.id);
  const expectedBoxes = configurations.reduce((sum, configuration) => sum + configuration!.valenceBoxes.reduce((count, entry) => count + entry.boxes.length, 0), 0);
  const expectedElectrons = configurations.reduce((sum, configuration) => sum + configuration!.valenceBoxes.reduce((count, entry) => count + entry.subshell.electrons, 0), 0);
  addCountProof(document, "kit_orbital_box_count", boxes, expectedBoxes, "orbital box count");
  addCountProof(document, "kit_orbital_electron_count", electrons, expectedElectrons, "orbital box electron count");
  document.source = {
    ...document.source,
    chemistryKitProof: configurations.map((configuration) => ({
      species: configuration!.element.symbol,
      charge: configuration!.charge,
      condensed: configuration!.condensed,
      unpairedElectrons: configuration!.unpairedElectrons,
    })),
  };
  return document;
}

function buildKitDocument(
  operator: ChemistryKitOperator,
  question: string,
  inputs: Record<string, unknown>,
  quantities: readonly QuantityRecord[],
): SceneDocument {
  switch (operator) {
    case "chem_skeletal_molecule": return skeletalDocument(question, inputs);
    case "chem_lewis_structure": return lewisDocument(question, inputs);
    case "chem_vsepr_shape": return vseprDocument(question, inputs);
    case "chem_reaction_energy_profile": return energyProfileDocument(question, inputs, quantities);
    case "chem_orbital_boxes": return orbitalBoxesDocument(question, inputs);
  }
}

/**
 * Expand planner-facing chemistry macros into the same primitive-producing
 * constructions as live chemistry families. The planner supplies chemistry
 * facts only; coordinates, labels, reveal geometry and proofs remain engine-owned.
 */
export function expandChemistryKitOperators(raw: unknown): ChemistryKitExpansionResult {
  if (!isRecord(raw) || !Array.isArray(raw.constructions)) {
    return { document: isRecord(raw) ? raw as unknown as SceneDocument : null, issues: [] };
  }
  const kitConstructions = raw.constructions.filter((construction) =>
    isRecord(construction) && typeof construction.operator === "string" && isChemistryKitOperator(construction.operator));
  if (kitConstructions.length === 0) return { document: raw as unknown as SceneDocument, issues: [] };

  const issues: SceneIssue[] = [];
  const question = isRecord(raw.source) && typeof raw.source.question === "string" && raw.source.question.trim()
    ? raw.source.question.trim()
    : null;
  if (!question) {
    return {
      document: null,
      issues: [{ code: "invalid_chemistry_kit_source", message: "chemistry kit operators require source.question", severity: "fatal", path: "source.question" }],
    };
  }
  if (!Array.isArray(raw.entities) || !Array.isArray(raw.requiredEntityIds) || !Array.isArray(raw.revealGroups)) {
    return {
      document: null,
      issues: [{ code: "invalid_chemistry_kit_document", message: "chemistry kit operators require entities, requiredEntityIds and revealGroups arrays", severity: "fatal" }],
    };
  }

  const quantities = quantitiesFrom(raw);
  let entities = [...raw.entities];
  let constructions = [...raw.constructions];
  const relations = Array.isArray(raw.relations) ? [...raw.relations] : [];
  const assertions = Array.isArray(raw.assertions) ? [...raw.assertions] : [];
  const annotations = Array.isArray(raw.annotations) ? [...raw.annotations] : [];
  let requiredEntityIds = [...raw.requiredEntityIds];
  let revealGroups = [...raw.revealGroups];
  const usedOperators: string[] = [];

  for (const candidate of kitConstructions) {
    const construction = candidate as Record<string, unknown>;
    const operator = construction.operator as ChemistryKitOperator;
    const constructionId = typeof construction.id === "string" ? construction.id : operator;
    const outputs = Array.isArray(construction.outputs)
      ? construction.outputs.filter((output): output is string => typeof output === "string")
      : [];
    const output = outputs.length === 1 ? outputs[0]! : null;
    try {
      if (!output) throw new Error("must have exactly one output group");
      const outputEntity = entities.find((entity) => isRecord(entity) && entity.id === output);
      if (!isRecord(outputEntity) || outputEntity.kind !== "group") throw new Error(`output ${output} must be declared as a group entity`);
      const owners = revealGroups.filter((group) => isRecord(group) && Array.isArray(group.entityIds) && group.entityIds.includes(output));
      if (owners.length === 0) throw new Error(`output ${output} must belong to a reveal group`);
      const externalReference = [...constructions, ...relations, ...assertions, ...annotations].some((item) => {
        if (item === candidate || !isRecord(item)) return false;
        return JSON.stringify(item).includes(`"${output}"`);
      });
      if (externalReference) throw new Error(`output ${output} cannot be referenced outside its reveal and required lists`);
      if (!isRecord(construction.inputs)) throw new Error("inputs must be an object");
      const generated = prefixDocument(buildKitDocument(operator, question, construction.inputs, quantities), output);
      entities = [
        ...entities.filter((entity) => !isRecord(entity) || entity.id !== output),
        ...generated.entities,
      ];
      constructions = [
        ...constructions.filter((item) => item !== candidate),
        ...generated.constructions,
      ];
      relations.push(...generated.relations);
      assertions.push(...generated.assertions);
      annotations.push(...generated.annotations);
      requiredEntityIds = requiredEntityIds.flatMap((id) => id === output ? generated.requiredEntityIds : [id]);
      revealGroups = revealGroups.map((group) => {
        if (!isRecord(group) || !Array.isArray(group.entityIds)) return group;
        return {
          ...group,
          entityIds: group.entityIds.flatMap((id) => id === output ? generated.requiredEntityIds : [id]),
        };
      });
      usedOperators.push(operator);
    } catch (error) {
      issues.push({
        code: "invalid_chemistry_kit_input",
        message: `${constructionId}: ${error instanceof Error ? error.message : String(error)}`,
        severity: "fatal",
        path: `constructions.${constructionId}`,
        ...(output ? { entityIds: [output] } : {}),
      });
    }
  }
  if (issues.length > 0) return { document: null, issues };

  return {
    document: {
      ...raw,
      source: { ...(raw.source as Record<string, unknown>), chemistryKitOperators: usedOperators },
      entities,
      constructions,
      relations,
      assertions,
      annotations,
      requiredEntityIds,
      revealGroups,
    } as unknown as SceneDocument,
    issues: [],
  };
}
