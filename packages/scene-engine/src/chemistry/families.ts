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
import { asksToShowHydrogenBond, hydrogenBondFigureLeads, mentionsHydrogenBond } from "./bondingFigures";
import { chemStem, type ChemFamilyBuilder } from "./sceneKit";

/**
 * A family after Lewis in catalog order yields a hydrogen bond ask the Lewis
 * figure leads, even when that figure declines: it would be taking a turn it
 * never had. `alsoDeclines` adds what this family cannot answer at all. Cues
 * stay as they are, so routing does not move. VSEPR comes before Lewis and
 * keeps its turn, and a stem naming no such species keeps its Raoult figure.
 */
function afterHydrogenBondFigure(build: ChemFamilyBuilder, alsoDeclines?: (stem: string) => boolean): ChemFamilyBuilder {
  return (question, quantities, schematic) => {
    const stem = chemStem(question);
    return hydrogenBondFigureLeads(stem) || alsoDeclines?.(stem) ? null : build(question, quantities, schematic);
  };
}

registerChemistryFamily({ family: VSEPR_FAMILY, cue: isVseprStem, build: buildVseprScene });
registerChemistryFamily({ family: LEWIS_FAMILY, cue: isLewisStem, build: buildLewisScene });
registerChemistryFamily({ family: MO_FAMILY, cue: isMoStem, build: afterHydrogenBondFigure(buildMoScene, mentionsHydrogenBond) });
registerChemistryFamily({ family: ORBITAL_FAMILY, cue: isOrbitalStem, build: afterHydrogenBondFigure(buildOrbitalScene, mentionsHydrogenBond) });
registerChemistryFamily({ family: CFT_FAMILY, cue: isCrystalFieldStem, build: afterHydrogenBondFigure(buildCrystalFieldScene, mentionsHydrogenBond) });
registerChemistryFamily({ family: COORD_FAMILY, cue: isCoordinationStem, build: afterHydrogenBondFigure(buildCoordinationScene, mentionsHydrogenBond) });
registerChemistryFamily({ family: ELECTROCHEM_FAMILY, cue: isElectrochemStem, build: afterHydrogenBondFigure(buildElectrochemScene, mentionsHydrogenBond) });
registerChemistryFamily({ family: SOLID_FAMILY, cue: isUnitCellStem, build: afterHydrogenBondFigure(buildUnitCellScene, mentionsHydrogenBond) });
registerChemistryFamily({ family: KINETICS_FAMILY, cue: isKineticsStem, build: afterHydrogenBondFigure(buildKineticsScene, mentionsHydrogenBond) });
registerChemistryFamily({ family: THERMO_FAMILY, cue: isThermoGraphStem, build: afterHydrogenBondFigure(buildThermoGraphScene, mentionsHydrogenBond) });
registerChemistryFamily({ family: SOLUTIONS_FAMILY, cue: isSolutionsGraphStem, build: afterHydrogenBondFigure(buildSolutionsGraphScene) });
registerChemistryFamily({ family: PERIODIC_FAMILY, cue: isPeriodicTrendStem, build: afterHydrogenBondFigure(buildPeriodicTrendScene) });
registerChemistryFamily({ family: ORGANIC_FAMILY, cue: isOrganicStem, build: afterHydrogenBondFigure(buildOrganicScene, asksToShowHydrogenBond) });
