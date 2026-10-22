/** Closed source interval operands reuse the numeric authority module. */
export { readChemistrySourceInterval as readSourceQuantityRange,
  chemistrySourceIntervalOwnsDimension as sourceQuantityRangeOwnsDimension,
  chemistrySourceIntervalInventoryOwned as sourceQuantityRangeInventoryOwned } from "./quantityReader";
export type { ChemistrySourceInterval as SourceQuantityRange } from "./quantityReader";
