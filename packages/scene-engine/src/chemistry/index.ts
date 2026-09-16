/**
 * Chemistry figures for the verified diagram engine.
 *
 * Every family here computes its geometry from the formula, the named
 * process or the numbers in the stem, through the same validator, compiler
 * and label engine as physics. Family modules are registered in catalog
 * order; see router.ts for the order and classify.ts for the subject test.
 */
import "./families";

export {
  CHEMISTRY_SCENE_FAMILIES,
  CHEMISTRY_FAMILY_NAMES,
  chemistryFamilyBuilder,
  describeSceneFamily,
  inferChemistryFamilies,
  isChemistryQuestion,
  isChemistrySceneFamily,
  registerChemistryFamily,
  type ChemistrySceneFamily,
} from "./router";
export { isChemistryStem, isAtomicTransitionStem } from "./classify";
export { ChemScene, chemStem, planQuantity, numberAfter, type ChemPlanQuantity, type ChemFamilyBuilder } from "./sceneKit";
export { parseFormula, parseComplex, formulaTokens, complexTokens, normalizeChemistryText, ligandSpec } from "./formula";
export { ELEMENTS, elementBySymbol, elementByName, elementByZ, resolveElement, valenceElectrons } from "./elements";
export { electronConfiguration, dElectronCount } from "./electronConfiguration";
