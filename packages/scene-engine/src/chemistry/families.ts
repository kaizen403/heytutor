/**
 * Registration of the chemistry family modules in catalog order. Imported for
 * its side effect by the package index, so the router knows every family
 * before the first stem is classified.
 */
import { registerChemistryFamily } from "./router";
import { ORGANIC_FAMILY, isOrganicStem, buildOrganicScene } from "./organic";
import { VSEPR_FAMILY, isVseprStem, buildVseprScene } from "./vsepr";
import { LEWIS_FAMILY, isLewisStem, buildLewisScene } from "./lewis";
import { MO_FAMILY, isMoStem, buildMoScene } from "./moDiagram";
import { ORBITAL_FAMILY, isOrbitalStem, buildOrbitalScene } from "./orbitalBox";
import { CFT_FAMILY, isCrystalFieldStem, buildCrystalFieldScene } from "./crystalField";
import { COORD_FAMILY, isCoordinationStem, buildCoordinationScene } from "./coordination";
import { ELECTROCHEM_FAMILY, isElectrochemStem, buildElectrochemScene } from "./electrochemistry";
import { SOLID_FAMILY, isUnitCellStem, buildUnitCellScene } from "./unitCell";
import { KINETICS_FAMILY, isKineticsStem, buildKineticsScene } from "./kinetics";
import { THERMO_FAMILY, isThermoGraphStem, buildThermoGraphScene } from "./thermoGraphs";
import { SOLUTIONS_FAMILY, isSolutionsGraphStem, buildSolutionsGraphScene } from "./solutionsGraphs";
import { PERIODIC_FAMILY, isPeriodicTrendStem, buildPeriodicTrendScene } from "./periodicTrend";
import { hydrogenBondAsked } from "./bondingFigures";
import { chemStem, type ChemFamilyBuilder } from "./sceneKit";

/**
 * A hydrogen bond ask belongs to the Lewis family alone. When that figure
 * declines, no later family may take the turn: thermo drew a barrier for bond
 * formation, the orbital family read "hydrogen" as the element, the unit cell
 * drew a cube that read as yes. Cues stay as they are, so routing does not move.
 */
function notForHydrogenBondAsk(build: ChemFamilyBuilder): ChemFamilyBuilder {
  return (question, quantities, schematic) => hydrogenBondAsked(chemStem(question)) ? null : build(question, quantities, schematic);
}

registerChemistryFamily({ family: VSEPR_FAMILY, cue: isVseprStem, build: notForHydrogenBondAsk(buildVseprScene) });
registerChemistryFamily({ family: LEWIS_FAMILY, cue: isLewisStem, build: buildLewisScene });
registerChemistryFamily({ family: MO_FAMILY, cue: isMoStem, build: notForHydrogenBondAsk(buildMoScene) });
registerChemistryFamily({ family: ORBITAL_FAMILY, cue: isOrbitalStem, build: notForHydrogenBondAsk(buildOrbitalScene) });
registerChemistryFamily({ family: CFT_FAMILY, cue: isCrystalFieldStem, build: notForHydrogenBondAsk(buildCrystalFieldScene) });
registerChemistryFamily({ family: COORD_FAMILY, cue: isCoordinationStem, build: notForHydrogenBondAsk(buildCoordinationScene) });
registerChemistryFamily({ family: ELECTROCHEM_FAMILY, cue: isElectrochemStem, build: notForHydrogenBondAsk(buildElectrochemScene) });
registerChemistryFamily({ family: SOLID_FAMILY, cue: isUnitCellStem, build: notForHydrogenBondAsk(buildUnitCellScene) });
registerChemistryFamily({ family: KINETICS_FAMILY, cue: isKineticsStem, build: notForHydrogenBondAsk(buildKineticsScene) });
registerChemistryFamily({ family: THERMO_FAMILY, cue: isThermoGraphStem, build: notForHydrogenBondAsk(buildThermoGraphScene) });
registerChemistryFamily({ family: SOLUTIONS_FAMILY, cue: isSolutionsGraphStem, build: notForHydrogenBondAsk(buildSolutionsGraphScene) });
registerChemistryFamily({ family: PERIODIC_FAMILY, cue: isPeriodicTrendStem, build: notForHydrogenBondAsk(buildPeriodicTrendScene) });
registerChemistryFamily({ family: ORGANIC_FAMILY, cue: isOrganicStem, build: notForHydrogenBondAsk(buildOrganicScene) });
