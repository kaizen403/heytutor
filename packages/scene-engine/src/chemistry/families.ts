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

registerChemistryFamily({ family: VSEPR_FAMILY, cue: isVseprStem, build: buildVseprScene });
registerChemistryFamily({ family: LEWIS_FAMILY, cue: isLewisStem, build: buildLewisScene });
registerChemistryFamily({ family: MO_FAMILY, cue: isMoStem, build: buildMoScene });
registerChemistryFamily({ family: ORBITAL_FAMILY, cue: isOrbitalStem, build: buildOrbitalScene });
registerChemistryFamily({ family: CFT_FAMILY, cue: isCrystalFieldStem, build: buildCrystalFieldScene });
registerChemistryFamily({ family: COORD_FAMILY, cue: isCoordinationStem, build: buildCoordinationScene });
registerChemistryFamily({ family: ELECTROCHEM_FAMILY, cue: isElectrochemStem, build: buildElectrochemScene });
registerChemistryFamily({ family: SOLID_FAMILY, cue: isUnitCellStem, build: buildUnitCellScene });
registerChemistryFamily({ family: KINETICS_FAMILY, cue: isKineticsStem, build: buildKineticsScene });
registerChemistryFamily({ family: THERMO_FAMILY, cue: isThermoGraphStem, build: buildThermoGraphScene });
registerChemistryFamily({ family: SOLUTIONS_FAMILY, cue: isSolutionsGraphStem, build: buildSolutionsGraphScene });
registerChemistryFamily({ family: PERIODIC_FAMILY, cue: isPeriodicTrendStem, build: buildPeriodicTrendScene });
registerChemistryFamily({ family: ORGANIC_FAMILY, cue: isOrganicStem, build: buildOrganicScene });
