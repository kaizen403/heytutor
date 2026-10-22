/** Engine-internal dependency seam; no caller evidence or public barrel cycle. */
export { compileSceneDocument } from "../../compile/compiler";
export type { SceneDocument, SceneConstruction, RenderScene } from "../../types";
export { chemistrySpeciesIdentity, checkedChemistrySourceIdentity, resolveChemistryStructure } from "./species";
export { findChemistryQuantities } from "../quantityReader";
export { isChemistryStem } from "../classify";
export type { ChemistryDimension, ChemistryReading } from "../quantityReader";
