/** Source-computed products lowered through the existing molecular renderer. */
import type { SceneDocument } from "../../types";
import { ChemScene } from "../sceneKit";
import { layoutBounds, layoutMolecule } from "./layout";
import { estimatePxPerUnit, renderMolecule, structureCaption } from "./render";
import type { OrganicReactionSource } from "./reactionSource";
import { asymmetricTreeStereo, sourceGraphProductHolds } from "./reactionGraph";

export function buildOrganicReactionFigure(question: string, model: OrganicReactionSource): SceneDocument | null {
  if (question !== model.question) return null;
  if (!sourceGraphProductHolds(model.kind, model.reactant, model)) return null;
  const carbonCounts = [model.reactant, model.product].map(molecule => molecule.atoms.filter(atom => atom.element === "C").length);
  if (JSON.stringify(carbonCounts) !== JSON.stringify(model.carbonCounts)) return null;
  if (model.kind === "radical_hbr") {
    const proof = asymmetricTreeStereo(model.product);
    if (!proof || JSON.stringify(proof) !== JSON.stringify(model.stereo)) return null;
  }
  const reactant = layoutMolecule(model.reactant), product = layoutMolecule(model.product);
  if (!reactant || !product) return null;
  const c = new ChemScene(question, "source-bound molecular graph transformation", "chem_organic");
  // These glyphs determine what the connected vertices are, rather than an
  // answer to be taught later. Name their actual ink in the molecule's own
  // reveal cue so the normal adapter reveals identity with its bond skeleton.
  const structuralAtoms = (ids: readonly string[]): string => {
    const labels: string[] = [];
    for (const id of ids) {
      const entity = c.scene.entities.find(candidate => candidate.id === id);
      if (!entity?.label) continue;
      entity.semantic = { ...entity.semantic, labelRequired: true };
      labels.push(entity.label);
    }
    return [...new Set(labels)].join(", ");
  };
  const bounds = [reactant, product].map(laid => layoutBounds(laid));
  const width = bounds.reduce((sum, b) => sum + b.maxX - b.minX + 0.3, 0) + 4.2;
  const height = Math.max(...bounds.map(b => b.maxY - b.minY)) + 3;
  const pxPerUnit = estimatePxPerUnit(width, height);
  const left = bounds[0]!, right = bounds[1]!;
  const reactantOrigin = { x: -left.minX, y: -(left.minY + left.maxY) / 2 };
  const initial = renderMolecule(c, reactant, "reactant", reactantOrigin, structureCaption(reactant), pxPerUnit);
  const arrowStart = initial.bounds.maxX + 0.6, arrowEnd = arrowStart + 2.5;
  const reagent = model.kind === "radical_hbr" ? "HBr / ROOR" : "Br2/NaOH reagent";
  const arrow = c.arrow("reaction_arrow", { x: arrowStart, y: 0 }, { x: arrowEnd, y: 0 }, "source reagent reaction", reagent);
  c.scene.labelled(...initial.labelledAtomIds, "reactant_name", arrow);
  const reactantAtoms = structuralAtoms(initial.labelledAtomIds);
  c.scene.group("reaction_source", [...initial.ids, arrow], `${reactantAtoms ? `Atoms ${reactantAtoms} in the source reactant` : "Source reactant"} ${model.reactant.name ?? "molecule"}, ${reagent}.`);
  const productOrigin = { x: arrowEnd + 0.6 - right.minX, y: -(right.minY + right.maxY) / 2 };
  const variable = /^addition product ([A-Z])$/.exec(model.productRole)?.[1];
  const result = renderMolecule(c, product, "product", productOrigin, model.product.name ?? (variable ? `Product ${variable}` : model.productRole), pxPerUnit);
  c.scene.labelled(...result.labelledAtomIds, "product_name");
  const productIds = [...result.ids];
  if (model.stereo) for (const atom of model.stereo.centres) {
    const at = product.positions[atom]!;
    productIds.push(c.text(`stereocentre_${atom}`, { x: at.x + productOrigin.x, y: at.y + productOrigin.y + 0.38 }, "C*", "computed stereocentre"));
    c.scene.labelled(`stereocentre_${atom}`);
  }
  const productAtoms = structuralAtoms(result.labelledAtomIds);
  c.scene.group("computed_product", productIds, `${productAtoms ? `Atoms ${productAtoms} in the computed product` : "Computed product"} ${model.product.name ?? model.productRole}; ${model.stereo ? "marked carbon stereocentres" : "retained amine graph"}.`, ["reaction_source"]);
  const answerY = Math.min(initial.bounds.minY, result.bounds.minY) - 0.7;
  const middle = (result.bounds.minX + result.bounds.maxX) / 2;
  const answerIds: string[] = [];
  if (model.stereo && model.requestedStereoCount) {
    c.scene.quantities.push({ id: "reaction_stereoisomers", symbol: "N", value: model.stereo.count, unit: "count" });
    answerIds.push(c.text("stereoisomer_count", { x: middle, y: answerY }, `N=${model.stereo.count}`, "derived stereoisomer count"));
    answerIds.push(c.text("stereocentre_count", { x: middle, y: answerY - 0.5 }, `${model.stereo.centres.length} stereocentres`, "derived stereocentre count"));
    answerIds.push(c.text("symmetry_qualification", { x: middle, y: answerY - 1 }, "No centre swap", "bounded symmetry proof"));
  } else if (!model.stereo) {
    answerIds.push(c.text("carbon_count_change", { x: middle, y: answerY }, `C atoms: ${carbonCounts[0]}->${carbonCounts[1]}`, "derived carbon count"));
    answerIds.push(c.text("carbonyl_carbon_lost", { x: middle, y: answerY - 0.5 }, "Carbonyl C lost", "removed source carbonyl carbon"));
  }
  if (model.gabrielExcluded) {
    answerIds.push(c.text("gabriel_scope", { x: (initial.bounds.minX + initial.bounds.maxX) / 2, y: answerY }, "Gabriel: aryl", "excluded Gabriel target"));
    answerIds.push(c.text("gabriel_limitation", { x: (initial.bounds.minX + initial.bounds.maxX) / 2, y: answerY - 0.5 }, "sp^2: no SN2", "aryl substitution limitation"));
  }
  if (answerIds.length) {
    c.scene.labelled(...answerIds);
    c.scene.group("reaction_answer", answerIds, model.stereo ? `Complete unequal branches, no centre exchange; N=${model.stereo.count}.` : `One carbonyl carbon is removed; ${model.product.name}.`, ["computed_product"]);
  }
  const document = c.build({ caption: model.kind === "radical_hbr"
    ? "HBr radical addition: Br at the less substituted alkene carbon. Stars identify stereocentres, not assigned configurations. Complete acyclic branches and absence of centre exchange determine the count."
    : "Hofmann primary-amide degradation: the retained group migrates to the original nitrogen; carbonyl carbon and oxygen leave the organic product. Reagents are Br2 and aqueous NaOH." });
  document.source = { ...document.source, organicReaction: model, nonMetric: true };
  return document;
}
