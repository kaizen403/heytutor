/** Same 218 frozen literal wordings; explicit serialized-scene/lowercase-temperature/notation oracle correction child of08c. */
import assert from "node:assert/strict";
import { kineticsFromStem, solveKinetics, buildKineticsScene } from "../../src/chemistry/kinetics";
import { buildSolutionsGraphScene } from "../../src/chemistry/solutionsGraphs";
import { buildSolutionLessonScene } from "../../src/chemistry/solutionProperties";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";
interface Case { id:string; question:string; kind:string; require?:boolean; first?:number; last?:number; ratio?:number; half?:number; energy?:number; pK?:number; base?:boolean; label?:string; caption?:boolean; captionIncludes?:string; extraLabels?:string[] }
const cases: Case[] = [
  {
    "id": "F5-orig",
    "question": "The rate constants of a reaction at two temperatures, 300 K and 310 K, are 2.0 × 10^-2 s^-1 and 7.0 × 10^-2 s^-1. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 3.5
  },
  {
    "id": "F5-three",
    "question": "The rate constants of a reaction at three temperatures, 300 K, 310 K and 320 K, are 2.0 × 10^-2 s^-1, 7.0 × 10^-2 s^-1 and 2.3 × 10^-1 s^-1. Calculate the activation energy.",
    "require": false,
    "kind": "refuse-kinetics",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F5-both",
    "question": "The rate constants of a reaction at both temperatures, 300 K and 310 K, are 2.0 × 10^-2 s^-1 and 7.0 × 10^-2 s^-1 respectively. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 3.5
  },
  {
    "id": "F5-twodiff",
    "question": "The rate constants of a reaction at two different temperatures, 300 K and 310 K, are 2.0 × 10^-2 s^-1 and 7.0 × 10^-2 s^-1. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 3.5
  },
  {
    "id": "F5-x",
    "question": "The rate constants of a reaction at two temperatures, 300 K and 310 K, are 2.0 x 10^-2 s^-1 and 7.0 x 10^-2 s^-1. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 3.5
  },
  {
    "id": "F5-sup",
    "question": "The rate constants of a reaction at two temperatures, 300 K and 310 K, are 2.0 × 10⁻² s⁻¹ and 7.0 × 10⁻² s⁻¹. Calculate the activation energy.",
    "require": false,
    "kind": "refuse-kinetics",
    "first": 300,
    "last": 310,
    "ratio": 3.5
  },
  {
    "id": "F5-singular2",
    "question": "At two temperatures, 300 K and 310 K, the rate constant of a reaction is 2.0 × 10^-2 s^-1 and 7.0 × 10^-2 s^-1 respectively. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 3.5
  },
  {
    "id": "F5-k1k2",
    "question": "For a reaction, k1 = 2.0 × 10^-2 s^-1 at 300 K and k2 = 7.0 × 10^-2 s^-1 at 310 K. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 3.5
  },
  {
    "id": "F5-Kis",
    "question": "The rate constant of a reaction at 300 K is 2.0 × 10^-2 s^-1 and at 310 K is 7.0 × 10^-2 s^-1. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 3.5
  },
  {
    "id": "F5-twotimes",
    "question": "The rate of a reaction becomes two times when the temperature increases from 300 K to 310 K. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F5-doubles",
    "question": "The rate of a reaction doubles when the temperature changes from 300 K to 310 K. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F5-factor3",
    "question": "The rate of a reaction increases by a factor of 3 when the temperature is raised from 300 K to 310 K. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 3
  },
  {
    "id": "F5-3times",
    "question": "When the temperature is raised from 300 K to 310 K, the rate of the reaction increases 3 times. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 3
  },
  {
    "id": "F5-threetimes",
    "question": "The rate of a reaction becomes three times when the temperature is raised from 300 K to 310 K. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 3
  },
  {
    "id": "F5-two-other",
    "question": "Two students measured the rate constant of a reaction. It doubles when the temperature is raised from 300 K to 310 K. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F5-twoexp",
    "question": "In two experiments the rate of a reaction was measured; the rate triples between 300 K and 310 K. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 3
  },
  {
    "id": "F5-ten",
    "question": "The rate of a reaction becomes ten times when the temperature is raised from 300 K to 340 K. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 340,
    "ratio": 10
  },
  {
    "id": "F6-orig",
    "question": "The rate of a reaction doubles for a 10 K rise in temperature from 300 K. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F6-degC",
    "question": "The rate of a reaction doubles for a 10 °C rise in temperature from 27 °C. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300.15,
    "last": 310.15,
    "ratio": 2
  },
  {
    "id": "F6-riseof",
    "question": "The rate of a reaction doubles for a rise of 10 K in temperature from 300 K. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F6-27to37",
    "question": "The rate of a reaction doubles on raising the temperature from 27 °C to 37 °C. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300.15,
    "last": 310.15,
    "ratio": 2
  },
  {
    "id": "F6-every10deg",
    "question": "The rate of a reaction doubles for every 10 degree rise in temperature from 298 K. Calculate the activation energy.",
    "require": false,
    "kind": "refuse-kinetics"
  },
  {
    "id": "F6-incby",
    "question": "The rate constant of a reaction doubles when the temperature is increased by 10 K from 298 K. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 298,
    "last": 308,
    "ratio": 2
  },
  {
    "id": "F6-A10Krise",
    "question": "A 10 K rise in temperature from 300 K doubles the rate of a reaction. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F6-with10K",
    "question": "The rate of a reaction doubles with a 10 K increase in temperature from 300 K. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F6-on10K",
    "question": "The rate of a reaction doubles on a 10 K rise in temperature from 300 K. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F6-raisedthrough",
    "question": "The rate of a reaction doubles when the temperature is raised through 10 K from 300 K. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F6-gte",
    "question": "The rate constant of a reaction doubles when temperature rises by 10 K from 300 K. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F6-incfrom-by",
    "question": "The rate constant doubles when the temperature is increased from 298 K by 10 K. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 298,
    "last": 308,
    "ratio": 2
  },
  {
    "id": "F6-change10",
    "question": "The rate constant of a reaction doubles for a temperature change of 10 K starting at 300 K. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F6-delta",
    "question": "The rate constant of a reaction doubles when the temperature goes up 10 K from 300 K. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F6-3temps",
    "question": "What is the rate constant at 320 K if k at 300 K is 2.0 × 10^-2 s^-1 and at 310 K is 7.0 × 10^-2 s^-1? Calculate the activation energy first.",
    "require": false,
    "kind": "refuse-kinetics"
  },
  {
    "id": "F7-orig",
    "question": "For a first order reaction with half life 20 min, find [A]/[A]0 at t = 60 min.",
    "require": true,
    "kind": "half",
    "half": 20
  },
  {
    "id": "F7-this",
    "question": "The half life of this first order reaction is 69.3 s. What fraction remains after 200 s?",
    "require": true,
    "kind": "half",
    "half": 69.3
  },
  {
    "id": "F7-t12eq",
    "question": "For a first order reaction t1/2 = 20 min. Find the fraction left after 1 hour.",
    "require": false,
    "kind": "half",
    "half": 20
  },
  {
    "id": "F7-thalf-is",
    "question": "For a first order reaction, t½ is 20 min. Calculate the fraction remaining after 60 min.",
    "require": false,
    "kind": "half",
    "half": 20
  },
  {
    "id": "F7-hl-minutes",
    "question": "A first order reaction has a half-life of 20 minutes. What fraction of the reactant is left after 1 hour?",
    "require": true,
    "kind": "half",
    "half": 20
  },
  {
    "id": "F7-which",
    "question": "The half life of the reaction, which is first order, is 30 s. Find the fraction remaining after 90 s.",
    "require": false,
    "kind": "half",
    "half": 30
  },
  {
    "id": "F7-75given",
    "question": "Find the half life of a first order reaction if the time for 75% completion is 60 min.",
    "require": true,
    "kind": "half",
    "half": 30
  },
  {
    "id": "F7-whoseK",
    "question": "What is the half life of a first order reaction whose rate constant is 1.155 × 10^-3 s^-1?",
    "require": false,
    "kind": "half",
    "half": 600.1274290562297
  },
  {
    "id": "F7-ratefirst",
    "question": "The rate constant of a first order reaction is 0.0231 min^-1. Find the half life and the fraction left at t = 60 min.",
    "require": false,
    "kind": "half",
    "half": 30.006371452811486
  },
  {
    "id": "F7-hlat300",
    "question": "The half life of a first order reaction at 300 K is 20 min. What fraction remains after 60 min?",
    "require": false,
    "kind": "half",
    "half": 20
  },
  {
    "id": "F7-fortime",
    "question": "The half life for a first order reaction when the time t = 40 min is 20 min. What fraction remains after 60 min?",
    "require": false,
    "kind": "refuse-kinetics"
  },
  {
    "id": "F7-hl-then-t",
    "question": "Half life of a first order reaction is 20 min; calculate [A]/[A]0 at t = 60 min.",
    "require": true,
    "kind": "half",
    "half": 20
  },
  {
    "id": "F7-k-then-hl",
    "question": "A first order reaction is 50% complete in 20 min. What fraction remains at t = 60 min, and what is its half life?",
    "require": false,
    "kind": "half",
    "half": 20
  },
  {
    "id": "F7-whatis-hl-k",
    "question": "What is the half life of a first order reaction for which k is 0.0231 min^-1? What fraction remains after 60 min?",
    "require": false,
    "kind": "half",
    "half": 30.006371452811486
  },
  {
    "id": "F7-hl-calc75",
    "question": "Calculate the half life of a first order reaction if the time required for 75 % completion is 60 min.",
    "require": true,
    "kind": "half",
    "half": 30
  },
  {
    "id": "P1-lnk-lower",
    "question": "For a reaction ln k = 5 - 2000/t. Calculate the activation energy.",
    "require": false,
    "kind": "refuse-kinetics"
  },
  {
    "id": "P1-lnk-upper",
    "question": "For a reaction ln k = 5 - 2000/T. Calculate the activation energy.",
    "require": false,
    "kind": "energy",
    "energy": 16628.0
  },
  {
    "id": "P1-logk-ncert",
    "question": "The rate constant for the first order decomposition of H2O2 is given by the following equation: log k = 14.34 - 1.25 × 10^4 K/T. Calculate Ea for this reaction.",
    "require": false,
    "kind": "energy",
    "energy": 239296.15578940624
  },
  {
    "id": "P1-logk-endash",
    "question": "The rate constant for the first order decomposition of H2O2 is given by the following equation: log k = 14.34 – 1.25 × 10^4 K/T. Calculate Ea for this reaction.",
    "require": false,
    "kind": "refuse-kinetics"
  },
  {
    "id": "P1-logk-lower",
    "question": "The rate constant for the first order decomposition of H2O2 is given by log k = 14.34 - 1.25 × 10^4 K/t. Calculate Ea for this reaction.",
    "require": false,
    "kind": "refuse-kinetics"
  },
  {
    "id": "P1-exp",
    "question": "The decomposition of a hydrocarbon follows the equation k = (4.5 × 10^11 s^-1) e^(-28000 K/T). Calculate Ea.",
    "require": false,
    "kind": "energy",
    "energy": 232792.0
  },
  {
    "id": "P1-exp-lower",
    "question": "The decomposition of a hydrocarbon follows the equation k = (4.5 × 10^11 s^-1) e^(-28000 K/t). Calculate Ea.",
    "require": false,
    "kind": "refuse-kinetics"
  },
  {
    "id": "P1-general",
    "question": "Using the Arrhenius equation k = A e^(-Ea/RT), calculate the activation energy if the rate constant doubles when the temperature is raised from 300 K to 310 K.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "P1-general2",
    "question": "The rate constant doubles when the temperature is raised from 300 K to 310 K. Use k = A e^(-Ea/RT) to find Ea.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "P1-T1T2",
    "question": "The rate constant of a reaction doubles between T1 = 300 K and T2 = 310 K. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "P1-t1t2",
    "question": "The rate constant of a reaction doubles between t1 = 300 K and t2 = 310 K. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "P1-t60",
    "question": "A first order reaction has k = 0.0231 min^-1 at 300 K. Find [A]/[A]0 at t = 60 min.",
    "require": false,
    "kind": "half",
    "half": 30.006371452811486
  },
  {
    "id": "P1-t12-10",
    "question": "A first order reaction has t1/2 = 10 min at 300 K. What fraction remains at t = 30 min?",
    "require": false,
    "kind": "half",
    "half": 10
  },
  {
    "id": "P1-LnK",
    "question": "For a reaction ln K = 5 - 2000/T. Calculate the activation energy.",
    "require": false,
    "kind": "refuse-kinetics"
  },
  {
    "id": "P1-log10k",
    "question": "For a reaction log10 k = 14.34 - 1.25 × 10^4 K/T. Calculate the activation energy.",
    "require": false,
    "kind": "energy",
    "energy": 239296.15578940624
  },
  {
    "id": "P1-Ea-t",
    "question": "The activation energy of a first order reaction is 50 kJ/mol and its half life at 300 K is 10 min. What fraction remains at t = 30 min?",
    "require": false,
    "kind": "half",
    "half": 10
  },
  {
    "id": "P1-lnk-time",
    "question": "For a first order reaction ln k = 5 - 2000/T and the half life is 10 min at t = 0. Calculate the activation energy.",
    "require": false,
    "kind": "energy",
    "energy": 16628.0
  },
  {
    "id": "F6b-every10C",
    "question": "The rate of a reaction doubles for every 10 °C rise in temperature from 25 °C. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 298.15,
    "last": 308.15,
    "ratio": 2
  },
  {
    "id": "F6b-each10K",
    "question": "The rate of a reaction doubles for each 10 K rise in temperature starting from 300 K. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F6b-by10Krise",
    "question": "The rate of a reaction is doubled by a 10 K rise in temperature from 300 K. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F6b-rises10above",
    "question": "When the temperature rises 10 K above 300 K, the rate of the reaction doubles. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F6b-increase-of",
    "question": "An increase of 10 K in temperature from 300 K doubles the rate constant of a reaction. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F6b-10Kincrease-for",
    "question": "The rate constant of a reaction doubles for a 10 K increase from 300 K. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F6b-tempcoeff",
    "question": "The rate of a reaction doubles when the temperature is raised from 300 K to 310 K and then by 10 K more. Calculate the activation energy.",
    "require": false,
    "kind": "refuse-kinetics"
  },
  {
    "id": "F7b-90pct",
    "question": "Calculate the half life for a first order reaction if the time taken for 90 % completion is 46.06 min.",
    "require": true,
    "kind": "half",
    "half": 13.865441600282972
  },
  {
    "id": "F7b-oneeighth",
    "question": "Determine the half life of a first order reaction for which the time to fall to one eighth of the initial concentration is 30 min.",
    "require": false,
    "kind": "half",
    "half": 10
  },
  {
    "id": "F7b-999",
    "question": "What is the half life of a first order reaction if the time for 99.9% completion is 100 min?",
    "require": true,
    "kind": "half",
    "half": 10.034333188799375
  },
  {
    "id": "F7b-875",
    "question": "Find the half-life of a first order reaction if the time required for 87.5% completion is 60 min.",
    "require": true,
    "kind": "half",
    "half": 20
  },
  {
    "id": "F7b-50pct",
    "question": "What is the half life of a first order reaction if the time for 50% completion is 20 min?",
    "require": true,
    "kind": "half",
    "half": 20
  },
  {
    "id": "F7b-k-is",
    "question": "Find the half life of a first order reaction for which the rate constant is 0.0231 per min.",
    "require": false,
    "kind": "half",
    "half": 30.006371452811486
  },
  {
    "id": "F7b-conc-is",
    "question": "Find the half life of a first order reaction for which the concentration after 60 min is one eighth of the initial value.",
    "require": false,
    "kind": "half",
    "half": 20
  },
  {
    "id": "F7b-tthalfeq",
    "question": "For a first order reaction t½ = 20 min. What fraction remains after 60 min?",
    "require": true,
    "kind": "half",
    "half": 20
  },
  {
    "id": "F7b-tthalfeq2",
    "question": "For a first order reaction t½=20 min. What fraction remains after 60 min?",
    "require": true,
    "kind": "half",
    "half": 20
  },
  {
    "id": "F7b-t_1/2",
    "question": "For a first order reaction t_1/2 = 20 min. What fraction remains after 60 min?",
    "require": true,
    "kind": "half",
    "half": 20
  },
  {
    "id": "F7b-T1/2",
    "question": "For a first order reaction T1/2 = 20 min. What fraction remains after 60 min?",
    "require": true,
    "kind": "half",
    "half": 20
  },
  {
    "id": "F7b-t(1/2)",
    "question": "For a first order reaction t(1/2) = 20 min. What fraction remains after 60 min?",
    "require": true,
    "kind": "half",
    "half": 20
  },
  {
    "id": "F5b-2times",
    "question": "The rate of a reaction becomes 2 times when the temperature is raised from 300 K to 310 K. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F5b-ratek-twoK",
    "question": "The values of the rate constant at two temperatures 300 K and 310 K are 2.0 × 10^-2 s^-1 and 7.0 × 10^-2 s^-1. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 3.5
  },
  {
    "id": "F5b-ratio",
    "question": "The ratio k2/k1 of the rate constants at 310 K and 300 K is 3.5. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 3.5
  },
  {
    "id": "F5b-Ae-nospace",
    "question": "Using k = Ae^(-Ea/RT), calculate the activation energy if the rate constant doubles when the temperature is raised from 300 K to 310 K.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "F5b-Aexp",
    "question": "Using k = A exp(-Ea/RT), calculate the activation energy if the rate constant doubles when the temperature is raised from 300 K to 310 K.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "M18",
    "question": "The rate of a reaction doubles on raising the temperature from 27 °C to 37 °C. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300.15,
    "last": 310.15,
    "ratio": 2,
    "caption": true
  },
  {
    "id": "M15d",
    "question": "Henry's law constant for CO2 in water is 1.67 × 10^8 Pa at 298 K. Calculate the quantity of CO2 in 500 mL of soda water when packed under 2.5 atm CO2 pressure at 298 K.",
    "require": false,
    "kind": "refuse-property"
  },
  {
    "id": "M15-henry-c-O2",
    "question": "Using c = kH p, with kH = 1.3 × 10^-3 mol/(L atm) for O2 in water at 298 K, find the concentration of dissolved O2 at a partial pressure of 0.21 atm.",
    "require": true,
    "kind": "henry",
    "label": "c=2.73e-4 mol/L"
  },
  {
    "id": "M15-henry-c-CO2",
    "question": "Using c = kH p, with kH = 3.4 × 10^-2 mol/(L atm) for CO2 in water, find the concentration of dissolved CO2 at a partial pressure of 2.5 atm.",
    "require": true,
    "kind": "henry",
    "label": "c=0.085 mol/L"
  },
  {
    "id": "M15-henry-p-small",
    "question": "Using p = kH x, with kH = 1.67 × 10^8 Pa for CO2 in water, find the partial pressure when the mole fraction of dissolved gas is 2.5 × 10^-5.",
    "require": true,
    "kind": "henry",
    "label": "x=2.5e-5",
    "extraLabels": [
      "p=4175 Pa"
    ]
  },
  {
    "id": "M15-henry-p",
    "question": "Using p = kH x, with kH = 1.67 × 10^8 Pa for CO2 in water, find the partial pressure when the mole fraction of dissolved gas is 0.001.",
    "require": true,
    "kind": "henry",
    "label": "x=0.001",
    "extraLabels": [
      "p=167000 Pa"
    ]
  },
  {
    "id": "M15-henry-p-N2",
    "question": "Using p = kH x with kH = 76.48 kbar, find the partial pressure of N2 when x = 0.00001.",
    "require": false,
    "kind": "refuse-property"
  },
  {
    "id": "X-jee-endash-R",
    "question": "The rate of a reaction doubles when its temperature changes from 300 K to 310 K. Activation energy of such a reaction will be (R = 8.314 J K–1 mol–1 and log 2 = 0.301)",
    "require": false,
    "kind": "refuse-kinetics",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "X-R831",
    "question": "The rate of a reaction doubles when its temperature changes from 300 K to 310 K. Calculate the activation energy (R = 8.31 J K^-1 mol^-1).",
    "require": false,
    "kind": "refuse-kinetics",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "X-quadruple",
    "question": "The rate of a reaction quadruples when the temperature changes from 293 K to 313 K. Calculate the energy of activation of the reaction assuming that it does not change with temperature.",
    "require": false,
    "kind": "temperature",
    "first": 293,
    "last": 313,
    "ratio": 4
  },
  {
    "id": "X-fourtimes",
    "question": "The rate of a reaction becomes four times when the temperature changes from 293 K to 313 K. Calculate the activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 293,
    "last": 313,
    "ratio": 4
  },
  {
    "id": "X-riseof10C",
    "question": "The rate of a reaction doubles for a rise of 10 °C in temperature from 27 °C. Calculate the activation energy.",
    "require": true,
    "kind": "temperature",
    "first": 300.15,
    "last": 310.15,
    "ratio": 2
  },
  {
    "id": "X-hl-if-k",
    "question": "What is the half life of a first order reaction if the rate constant is 6.93 × 10^-3 s^-1?",
    "require": false,
    "kind": "half",
    "half": 100.02123817603828
  },
  {
    "id": "X-ncert-30pct",
    "question": "A first order reaction takes 40 min for 30% decomposition. Calculate t1/2.",
    "require": false,
    "kind": "half",
    "half": 77.73432839498926
  },
  {
    "id": "X-hl-sentence2",
    "question": "A first order reaction is 75% complete in 60 min. Find its half life.",
    "require": false,
    "kind": "half",
    "half": 30
  },
  {
    "id": "X-hl-time-75",
    "question": "Find the half life of a first order reaction if the time required for 75 % of the reaction to complete is 60 min.",
    "require": false,
    "kind": "half",
    "half": 30
  },
  {
    "id": "X-hl-when-is",
    "question": "The half life of a first order reaction when the time for 75% completion is 60 min is to be found. Draw the decay curve.",
    "require": false,
    "kind": "half",
    "half": 30
  },
  {
    "id": "X-hl-whose-t90",
    "question": "Calculate the half life of a first order reaction whose t90 is 46 min.",
    "require": false,
    "kind": "refuse-kinetics"
  },
  {
    "id": "X-hl-for-k-is",
    "question": "Determine the half life for a reaction for which the time taken to reach 75 % completion is 30 s.",
    "require": false,
    "kind": "half",
    "half": 15
  },
  {
    "id": "NCERT-10K",
    "question": "The rate of a chemical reaction doubles for an increase of 10K in absolute temperature from 298K. Calculate Ea.",
    "require": true,
    "kind": "temperature",
    "first": 298,
    "last": 308,
    "ratio": 2
  },
  {
    "id": "every10C-at27",
    "question": "The rate of a reaction doubles for every 10 °C rise in temperature. Calculate the activation energy at 27 °C.",
    "require": true,
    "kind": "temperature",
    "first": 300.15,
    "last": 310.15,
    "ratio": 2
  },
  {
    "id": "every10C-noT",
    "question": "The rate of a reaction doubles for every 10 °C rise in temperature. Calculate the activation energy.",
    "require": false,
    "kind": "refuse-kinetics"
  },
  {
    "id": "F4-o1",
    "question": "50 mL of 0.1 M CH3COOH (Ka = 1 x 10-5) is titrated with 0.1 M NaOH.",
    "require": false,
    "kind": "refuse-titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-o2",
    "question": "50 mL of 0.1 M CH3COOH (Ka = 1 × 10⁻⁵) is titrated with 0.1 M NaOH.",
    "require": true,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v1",
    "question": "50 mL of 0.1 M CH3COOH (Ka = 1.0 × 10^-5) is titrated with 0.1 M NaOH.",
    "require": true,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v2",
    "question": "50 mL of 0.1 M CH3COOH (Ka of 1e-5) is titrated with 0.1 M NaOH.",
    "require": false,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v3",
    "question": "50 mL of 0.1 M CH3COOH (pKa = 5) is titrated with 0.1 M NaOH.",
    "require": true,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v4",
    "question": "50 mL of 0.1 M NH3 (Kb = 1 × 10^-5) is titrated with 0.1 M HCl.",
    "require": true,
    "kind": "titration",
    "pK": 5,
    "base": true
  },
  {
    "id": "F4-v5",
    "question": "50 mL of 0.1 M CH3COOH (Ka = 1.8 × 10^-5) is titrated with 0.1 M NaOH.",
    "require": true,
    "kind": "titration",
    "pK": 4.7447274948966935,
    "base": false
  },
  {
    "id": "F4-v6",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. Ka = 1 X 10^-5.",
    "require": false,
    "kind": "refuse-titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v7",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. Ka = 1x10^-5.",
    "require": true,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v8",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. Ka = 10^-5.",
    "require": true,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v9",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. Ka = 1e-5.",
    "require": true,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v10",
    "question": "50 mL of 0.1 M acetic acid is titrated with 0.1 M NaOH. Ka for acetic acid is 1 × 10^-5.",
    "require": false,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v11",
    "question": "50 mL of 0.1 M acetic acid is titrated with 0.1 M NaOH. The dissociation constant of acetic acid is 1 × 10^-5.",
    "require": false,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v12",
    "question": "50 mL of 0.1 M acetic acid (acid dissociation constant 1 × 10^-5) is titrated with 0.1 M NaOH.",
    "require": false,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v13",
    "question": "50 mL of 0.1 M acetic acid is titrated with 0.1 M NaOH. K_a = 1 × 10^-5.",
    "require": false,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v14",
    "question": "50 mL of 0.1 M acetic acid is titrated with 0.1 M NaOH. K_{a} = 1 × 10^{-5}.",
    "require": false,
    "kind": "refuse-titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v15",
    "question": "50 mL of 0.1 M acetic acid is titrated with 0.1 M NaOH (pKa of acetic acid = 5.0).",
    "require": false,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v16",
    "question": "50 mL of 0.1 M NH4OH is titrated with 0.1 M HCl. Kb of NH4OH = 1 × 10^-5.",
    "require": false,
    "kind": "titration",
    "pK": 5,
    "base": true
  },
  {
    "id": "F4-v17",
    "question": "50 mL of 0.1 M NH3 is titrated with 0.1 M HCl. Ka of NH4+ = 1 × 10^-9.",
    "require": false,
    "kind": "refuse-titration",
    "pK": 5,
    "base": true
  },
  {
    "id": "F4-v18",
    "question": "50 mL of 0.1 M HCOOH (Ka = 1 × 10^-5) is titrated with 0.1 M NaOH.",
    "require": true,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v19",
    "question": "50 mL of 0.1 M weak acid HA (Ka = 1 × 10^-5) is titrated with 0.1 M NaOH.",
    "require": true,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v20",
    "question": "50 mL of 0.1 M CH3COOH (ionisation constant 1 × 10^-5) is titrated with 0.1 M NaOH.",
    "require": false,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v21",
    "question": "50 mL of 0.1 M CH3COOH (Ka = 1 × 10–5) is titrated with 0.1 M NaOH.",
    "require": false,
    "kind": "refuse-titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v22",
    "question": "50 mL of 0.1 M CH3COOH (Ka = 1 × 10^–5) is titrated with 0.1 M NaOH.",
    "require": false,
    "kind": "refuse-titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v23",
    "question": "50 mL of 0.1 M CH3COOH (Ka = 1 × 10^−5) is titrated with 0.1 M NaOH.",
    "require": false,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v24",
    "question": "50 mL of 0.1 M CH3COOH (pKa 5) is titrated with 0.1 M NaOH.",
    "require": true,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v25",
    "question": "50 mL of 0.1 M CH3COOH (Ka 1 × 10^-5) is titrated with 0.1 M NaOH.",
    "require": true,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v26",
    "question": "Draw the titration curve when 50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH, given Ka(CH3COOH) = 1 × 10^-5.",
    "require": false,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v27",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. Take the value of Ka as 1 × 10^-5.",
    "require": false,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "F4-v28",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. The Ka value is 1 × 10^-5.",
    "require": false,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "M12-3",
    "question": "Calculate the freezing point depression of a solution of 5.85 g NaCl (molar mass 58.5 g/mol) in 500 g water. The van't Hoff factor i = 2 and Kf = 1.86 K kg/mol.",
    "require": false,
    "kind": "no-apparent"
  },
  {
    "id": "M14-b",
    "question": "50 mL of 0.1 M K2Cr2O7 solution; 0.1 M NaOH titrated with 0.1 M HCl. Draw the titration curve.",
    "require": false,
    "kind": "refuse-titration"
  },
  {
    "id": "OWN-rise-before",
    "kind": "temperature",
    "question": "The rate of a reaction triples for an increase of 12 K from 288 K. Calculate the activation energy.",
    "first": 288,
    "last": 300,
    "ratio": 3,
    "require": true
  },
  {
    "id": "OWN-rise-after",
    "kind": "temperature",
    "question": "The reaction rate doubles when its temperature rises 8 K above 290 K. Calculate the activation energy.",
    "first": 290,
    "last": 298,
    "ratio": 2,
    "require": true
  },
  {
    "id": "OWN-rise-C",
    "kind": "temperature",
    "question": "The rate constant doubles with a 15 °C rise in temperature starting from 20 °C. Calculate the activation energy.",
    "first": 293.15,
    "last": 308.15,
    "ratio": 2,
    "require": true
  },
  {
    "id": "OWN-rise-through",
    "kind": "temperature",
    "question": "The reaction rate triples when temperature is raised through 20 K from 280 K. Calculate the activation energy.",
    "first": 280,
    "last": 300,
    "ratio": 3,
    "require": true
  },
  {
    "id": "OWN-low-absolute",
    "kind": "refuse-kinetics",
    "question": "The rate of a reaction doubles when temperature changes from 10 K to 300 K. Calculate the activation energy."
  },
  {
    "id": "OWN-rise-conflict",
    "kind": "refuse-kinetics",
    "question": "The rate constant doubles with a 10 K rise from 300 K to 325 K. Calculate the activation energy."
  },
  {
    "id": "OWN-rise-malformed",
    "kind": "refuse-kinetics",
    "question": "The rate constant doubles when temperature rises by 1e- K from 300 K. Calculate the activation energy."
  },
  {
    "id": "OWN-half-if-time",
    "kind": "half",
    "question": "Find the half life of a first order reaction if the time for 93.75% completion is 80 min.",
    "half": 20,
    "require": true
  },
  {
    "id": "OWN-half-for-time",
    "kind": "half",
    "question": "Calculate the half life for a first order reaction if the time taken for 87.5 % completion is 90 s.",
    "half": 30,
    "require": true
  },
  {
    "id": "OWN-half-when-time",
    "kind": "half",
    "question": "The half life of this first order reaction when the time for 50% completion is 18 min is required.",
    "half": 18,
    "require": true
  },
  {
    "id": "OWN-half-explicit",
    "kind": "half",
    "question": "The half life of this first order reaction is 12 min. What fraction remains after 36 min?",
    "half": 12,
    "require": true
  },
  {
    "id": "OWN-half-later-60",
    "kind": "half",
    "question": "Half life of the first order reaction is 15 min; find the fraction remaining at t = 60 min.",
    "half": 15,
    "require": true
  },
  {
    "id": "OWN-Ka-latex",
    "kind": "titration",
    "question": "25 mL of 0.1 M CH3COOH (K_{a} = 2 × 10^-5) is titrated with 0.1 M NaOH.",
    "pK": 4.698970004336019,
    "base": false
  },
  {
    "id": "OWN-Kb-latex-unread",
    "kind": "refuse-titration",
    "question": "25 mL of 0.1 M NH3 (K_{b} = 2 × 10^{-5}) is titrated with 0.1 M HCl."
  },
  {
    "id": "OWN-pKa-malformed",
    "kind": "refuse-titration",
    "question": "40 mL of 0.1 M acetic acid (pK_{a} = unknown) is titrated with 0.2 M NaOH."
  },
  {
    "id": "OWN-dissociation",
    "kind": "titration",
    "question": "40 mL of 0.1 M ethanoic acid is titrated with 0.2 M NaOH. Its acid dissociation constant is 2e-5.",
    "pK": 4.698970004336019,
    "base": false
  },
  {
    "id": "OWN-ionization-unread",
    "kind": "refuse-titration",
    "question": "30 mL of 0.2 M CH3COOH (ionization constant = 1e-) is titrated with 0.1 M NaOH."
  },
  {
    "id": "OWN-constant-conflict",
    "kind": "refuse-titration",
    "question": "50 mL of 0.1 M CH3COOH (Ka = 1e-5, pKa = 4) is titrated with 0.1 M NaOH."
  },
  {
    "id": "OWN-Henry-tiny-c",
    "kind": "henry",
    "question": "Using c = kH p for Henry's law, kH = 2 × 10^-5 mol/(L atm). Find concentration at a partial pressure of 0.2 atm.",
    "label": "c=4e-6 mol/L",
    "require": true
  },
  {
    "id": "OWN-Henry-tiny-x",
    "kind": "henry",
    "question": "Using p = kH x for Henry's law, kH = 100 kPa. Find partial pressure at x = 0.000002.",
    "label": "x=2e-6",
    "require": true,
    "extraLabels": [
      "p=2e-4 kPa"
    ]
  },
  {
    "id": "OWN-Henry-true-zero",
    "kind": "henry",
    "question": "Henry's law p = kH x has kH = 100 kPa. The partial pressure is zero. Find the mole fraction.",
    "label": "x=0",
    "require": true,
    "extraLabels": [
      "p=0 kPa"
    ]
  },
  {
    "id": "OWN-Henry-kPa",
    "kind": "henry",
    "question": "Henry's law p = kH x has kH = 200 kPa. Find the partial pressure at x = 0.02.",
    "label": "p=4 kPa",
    "require": true
  },
  {
    "id": "OWN-Henry-c-kPa",
    "kind": "henry",
    "question": "For Henry's law c = kH p, kH = 0.001 mol/(L kPa). Find concentration at a partial pressure of 0.2 kPa.",
    "label": "c=2e-4 mol/L"
  },
  {
    "id": "OWN-factor-freezing",
    "kind": "no-apparent",
    "question": "Calculate the freezing point depression for a 0.1 mol/kg solution. Its van't Hoff factor i = 2 and Kf = 1.86 K kg/mol."
  },
  {
    "id": "OWN-factor-boiling",
    "kind": "no-apparent",
    "question": "Calculate the boiling point elevation of a solution of 10 g solute (molar mass 100 g/mol) in 1 kg water. The van't Hoff factor i = 2."
  },
  {
    "id": "OWN-factor-osmotic",
    "kind": "no-apparent",
    "question": "Find the osmotic pressure of 0.1 M solute (true molar mass 60 g/mol). The van't Hoff factor i = 1.5, T = 300 K and R = 0.082 L atm/(mol K)."
  },
  {
    "id": "OWN-factor-mass-request",
    "kind": "apparent",
    "question": "A solute has true molar mass 60 g/mol and i = 1.5. Find its apparent molar mass.",
    "label": "M'=40 g/mol",
    "require": true
  },
  {
    "id": "OWN-factor-association",
    "kind": "apparent",
    "question": "A solute has true molar mass 60 g/mol and degree of association 0.8 with 2 monomers. Find the apparent molar mass.",
    "label": "M'=100 g/mol",
    "require": true
  },
  {
    "id": "OWN-caption-Celsius",
    "kind": "temperature",
    "question": "The rate constant doubles as temperature goes from 26 °C to 36 °C. Calculate the activation energy.",
    "first": 299.15,
    "last": 309.15,
    "ratio": 2,
    "require": true,
    "caption": true
  },
  {
    "id": "OWN-caption-half-centikelvin",
    "kind": "temperature",
    "question": "The rate constant triples when temperature changes from 25.5 °C to 35.5 °C. Calculate the activation energy.",
    "first": 298.65,
    "last": 308.65,
    "ratio": 3,
    "require": true,
    "caption": true
  },
  {
    "id": "OWN-caption-explicit-K",
    "kind": "temperature",
    "question": "The rate constant doubles between 300.15 K and 310.15 K. Calculate the activation energy.",
    "first": 300.15,
    "last": 310.15,
    "ratio": 2,
    "require": true,
    "caption": true
  },
  {
    "id": "M12-1",
    "question": "Calculate the depression in freezing point of 5.85 g NaCl (molar mass 58.5 g/mol) in 500 g water, i = 2, Kf = 1.86 K kg mol-1.",
    "require": false,
    "kind": "no-apparent"
  },
  {
    "id": "M12-2",
    "question": "Calculate the elevation in boiling point when 1.8 g glucose (molar mass 180 g/mol) is dissolved in 100 g water. Kb = 0.52 K kg mol-1.",
    "require": false,
    "kind": "no-apparent"
  },
  {
    "id": "M14-3",
    "question": "25 mL of 0.1 M K2Cr2O7 is titrated against Fe2+ solution. Draw the titration curve.",
    "require": false,
    "kind": "refuse-titration"
  },
  {
    "id": "M17b",
    "question": "Rate constant of a reaction doubles when the temperature is raised from 300 K to 310 K. Calculate the activation energy in kJ.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "M17c",
    "question": "The Rate constant of a reaction at 300 K is 2.0 × 10^-2 s^-1 and at 310 K is 7.0 × 10^-2 s^-1. Calculate the activation energy in kJ/mol.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 3.5
  },
  {
    "id": "M15a",
    "question": "The vapour pressures of pure liquids A and B are 40 kPa and 20 kPa respectively. Draw the vapour pressure against mole fraction graph for an ideal solution and find the total vapour pressure when x_A = 0.5.",
    "require": false,
    "kind": "raoult",
    "captionIncludes": "p_total = 30 kPa"
  },
  {
    "id": "M15b",
    "question": "Liquids A and B form an ideal solution. The vapour pressure of pure A is 40 kPa and that of pure B is 20 kPa. Plot the vapour pressure composition diagram (Raoult's law).",
    "require": false,
    "kind": "raoult",
    "captionIncludes": "p°_A = 40 kPa"
  },
  {
    "id": "M15c",
    "question": "The vapour pressure of water is 3.17 kPa at 298 K. Calculate the vapour pressure of a solution of 30 g of urea (molar mass 60 g/mol) in 846 g of water.",
    "require": false,
    "kind": "refuse-property"
  },
  {
    "id": "M15e",
    "question": "The vapour pressure of pure benzene at a certain temperature is 0.850 bar. A non-volatile, non-electrolyte solid weighing 0.5 g when added to 39.0 g of benzene (molar mass 78 g mol-1) gives a solution with vapour pressure 0.845 bar. What is the molar mass of the solid substance?",
    "require": false,
    "kind": "refuse-property"
  },
  {
    "id": "M15-nonvol",
    "question": "A nonvolatile solute is dissolved in water. The mole fraction of solute is 0.0491 and p° = 3.17 kPa. Find the vapour pressure of the solution.",
    "require": false,
    "kind": "property",
    "label": "p=3.014 kPa"
  },
  {
    "id": "M15-nonvol-torr",
    "question": "A nonvolatile solute is dissolved in a solvent. The mole fraction of solute is 0.2 and p° = 23.76 mm Hg. Find the vapour pressure of the solution.",
    "require": false,
    "kind": "property",
    "label": "p=2.534 kPa"
  },
  {
    "id": "M15-rel",
    "question": "Calculate the relative lowering of vapour pressure when the mole fraction of solute is 0.0491 and the pure solvent vapour pressure is 3.17 kPa.",
    "require": false,
    "kind": "property",
    "label": "p=3.014 kPa"
  },
  {
    "id": "M15-rel-tiny",
    "question": "Calculate the relative lowering of vapour pressure when the mole fraction of solute is 0.00018 and the pure solvent vapour pressure is 3.17 kPa.",
    "require": false,
    "kind": "property",
    "label": "p=3.169 kPa"
  },
  {
    "id": "M15-raoult-mixed",
    "question": "The vapour pressures of pure liquids A and B are 40 kPa and 150 torr respectively. Draw the vapour pressure against mole fraction graph for an ideal solution and find the total vapour pressure when x_A = 0.5.",
    "require": false,
    "kind": "raoult",
    "captionIncludes": "p_total = 225.0123 torr"
  },
  {
    "id": "M15-raoult-third",
    "question": "The vapour pressures of pure liquids A and B are 120 torr and 70 torr respectively. Draw the vapour pressure against mole fraction graph for an ideal solution and find the total vapour pressure when x_A = 0.333.",
    "require": false,
    "kind": "raoult",
    "captionIncludes": "p_total = 86.65 torr"
  },
  {
    "id": "H-p",
    "question": "Henry's law in the form p = kH x applies with kH = 1.67 × 10^8 Pa for CO2 in water. Find the partial pressure when the mole fraction of dissolved gas is 0.001.",
    "require": true,
    "kind": "henry",
    "label": "x=0.001",
    "extraLabels": [
      "p=167000 Pa"
    ]
  },
  {
    "id": "H-p-small",
    "question": "Henry's law in the form p = kH x applies with kH = 1.67 × 10^8 Pa for CO2 in water. Find the partial pressure when the mole fraction of dissolved gas is 2.5 × 10^-5.",
    "require": true,
    "kind": "henry",
    "label": "x=2.5e-5",
    "extraLabels": [
      "p=4175 Pa"
    ]
  },
  {
    "id": "H-p-x",
    "question": "Henry's law in the form p = kH x applies with kH = 76.48 bar for a gas. Find the partial pressure when x = 0.00004.",
    "require": true,
    "kind": "henry",
    "label": "x=4e-5",
    "extraLabels": [
      "p=0.003 bar"
    ]
  },
  {
    "id": "H-c-O2",
    "question": "Henry's law in the form c = kH p applies with kH = 1.3 × 10^-3 mol/(L atm) for O2 in water. Find the concentration of dissolved O2 at a partial pressure of 0.21 atm.",
    "require": true,
    "kind": "henry",
    "label": "c=2.73e-4 mol/L"
  },
  {
    "id": "H-c-CO2",
    "question": "Henry's law in the form c = kH p applies with kH = 3.4 × 10^-2 mol/(L atm) for CO2 in water. Find the concentration of dissolved CO2 at a partial pressure of 2.5 atm.",
    "require": true,
    "kind": "henry",
    "label": "c=0.085 mol/L"
  },
  {
    "id": "M14-ea-of-the",
    "question": "The activation energy of the reaction is 50 kJ/mol. By what factor does the rate constant increase when the temperature is raised from 300 K to 310 K?",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 1.909156545112441
  },
  {
    "id": "M14-sup",
    "question": "The rate constant of a first order reaction is k = 2.5 × 10⁻³ s⁻¹. Find the half life of the reaction.",
    "require": true,
    "kind": "half",
    "half": 277.25887222397813
  },
  {
    "id": "M14-caretless",
    "question": "The rate constant of a first order reaction is k = 2.5 x 10-3 s-1. Find the half life of the reaction.",
    "require": false,
    "kind": "refuse-kinetics"
  },
  {
    "id": "M14-K4",
    "question": "For the reversible reaction A <=> B with K = 4, starting with pure A, draw the graph showing the variation of concentration of A and B with time as the reaction attains equilibrium.",
    "require": false,
    "kind": "equilibrium",
    "captionIncludes": "K = 4"
  },
  {
    "id": "REVIEW-latex-Ka",
    "kind": "refuse-titration",
    "question": "50 mL of 0.1 M CH3COOH (K_{a} = 1 × 10^{-5}) is titrated with 0.1 M NaOH."
  },
  {
    "id": "independent-stated-ka-no-stock-fallback-1",
    "question": "Titrate 50 mL of 0.1 M acetic acid with 0.1 M NaOH; the given acid dissociation constant is 1 × 10^-5. Draw the curve.",
    "require": false,
    "kind": "titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "independent-stated-ka-no-stock-fallback-2",
    "question": "Draw the titration curve for 50 mL of 0.1 M CH3COOH with 0.1 M NaOH, using K_{a} = 1 × 10^{-5}.",
    "require": false,
    "kind": "refuse-titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "independent-stated-ka-no-stock-fallback-3",
    "question": "For 50 mL of 0.1 M CH3COOH titrated with 0.1 M NaOH, Ka is unknown. Draw the curve.",
    "require": false,
    "kind": "refuse-titration",
    "pK": 5,
    "base": false
  },
  {
    "id": "independent-kinetics-delta-owning-span-1",
    "question": "The rate of a reaction doubles on a 10 K rise from 300 K. Determine its activation energy.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "independent-kinetics-delta-owning-span-2",
    "question": "A reaction at 300 K is raised through 10 K, and the rate doubles. Calculate Ea.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "independent-kinetics-delta-owning-span-3",
    "question": "When a reaction undergoes an increase of 10 K from 300 K, its rate becomes twice the original rate. Find Ea.",
    "require": false,
    "kind": "temperature",
    "first": 300,
    "last": 310,
    "ratio": 2
  },
  {
    "id": "independent-half-life-no-cross-owner-1",
    "question": "Find the half life for a first order reaction whose time for 75% completion is 60 min.",
    "require": false,
    "kind": "half",
    "half": 30
  },
  {
    "id": "independent-half-life-no-cross-owner-2",
    "question": "A first order reaction takes 60 min to reach 75 % completion. What is its half life?",
    "require": false,
    "kind": "half",
    "half": 30
  },
  {
    "id": "independent-half-life-no-cross-owner-3",
    "question": "Determine the half life of a first order reaction if 90 % completion takes 46.06 min.",
    "require": false,
    "kind": "half",
    "half": 13.865441600282972
  },
  {
    "id": "independent-henry-nonzero-display-1",
    "question": "Using c = k_H p, let k_H = 1.3e-3 mol/(L atm) and the gas partial pressure be 0.21 atm. Find the dissolved concentration.",
    "require": false,
    "kind": "henry",
    "label": "c=2.73e-4 mol/L"
  },
  {
    "id": "independent-henry-nonzero-display-2",
    "question": "Apply Henry's law p = k_H x with k_H = 2.0e4 atm. At partial pressure 0.50 atm, find x.",
    "require": false,
    "kind": "henry",
    "label": "x=2.5e-5"
  },
  {
    "id": "independent-henry-nonzero-display-3",
    "question": "Henry's law is p = k_H x with k_H = 200 kPa and x = 0.02. Show the gas partial pressure.",
    "require": false,
    "kind": "henry",
    "label": "p=4 kPa"
  },
  {
    "id": "independent-organic-wrong-ask-fallback-1",
    "question": "50 mL of 0.1 M acetic acid, with an unread Ka value, is titrated using 0.1 M NaOH. Draw the titration curve.",
    "require": false,
    "kind": "no-organic"
  },
  {
    "id": "independent-organic-wrong-ask-fallback-2",
    "question": "Show the titration graph of methanoic acid with NaOH, using K_a = unknown.",
    "require": false,
    "kind": "no-organic"
  },
  {
    "id": "independent-organic-wrong-ask-fallback-3",
    "question": "Draw the acid-base titration curve of acetic acid with sodium hydroxide. The acid constant is not readable.",
    "require": false,
    "kind": "no-organic"
  },
  {
    "id": "OWN-wrong-ask-1",
    "question": "Draw the titration curve of acetic acid with NaOH. Ka = unavailable.",
    "kind": "refuse-titration"
  },
  {
    "id": "OWN-wrong-ask-2",
    "question": "For formic acid titrated with NaOH, K_{a} = 1e-. Show the pH curve.",
    "kind": "refuse-titration"
  },
  {
    "id": "OWN-wrong-ask-3",
    "question": "An acetic acid sample is titrated against sodium hydroxide with pK_a unknown. Draw the graph.",
    "kind": "refuse-titration"
  },
  {
    "id": "OWN-wrong-ask-4",
    "question": "Draw the titration curve of ethanoic acid using its unread ionisation constant.",
    "kind": "refuse-titration"
  },
  {
    "id": "OWN-wrong-ask-5",
    "question": "Draw the titration graph of methanoic acid and NaOH; the dissociation constant is illegible.",
    "kind": "refuse-titration"
  }
];
function near(actual:unknown, expected:number):void {
  assert.ok(typeof actual === "number" && Number.isFinite(actual));
  assert.ok(Math.abs(actual-expected)<=Math.max(Math.abs(expected)*1e-10,1e-14),`${actual} != ${expected}`);
}
function sceneNear(actual:unknown,expected:number):void {
  assert.ok(typeof actual === "number" && Number.isFinite(actual));
  assert.equal(actual,Number(expected.toFixed(6)),`${actual} != serialized ${expected}`);
}
function compiled(document:SceneDocument) {
  const valid=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));
  assert.ok(valid.document,JSON.stringify(valid.report.issues));
  const out=compileSceneDocument(valid.document);
  assert.ok(out.ok && out.renderScene,JSON.stringify(out.report.issues));
  return out.renderScene.primitives.filter(p=>p.kind==="label" && typeof p.text === "string").map(p=>p.text!);
}
function checkDocument(c:Case,document:SceneDocument):void {
  const labels=compiled(document),caption=document.annotations.find(a=>a.id==="figure_caption")?.text??"";
  assert.ok(!/NaN|Infinity|undefined/.test(labels.join(" ")+caption));
  if(c.kind==="temperature") {
    sceneNear(document.quantities.find(q=>q.id==="T1")?.value,c.first!);
    sceneNear(document.quantities.find(q=>q.id==="T2")?.value,c.last!);
    sceneNear(document.quantities.find(q=>q.id==="Ea")?.value,8.314*Math.log(c.ratio!)/(1/c.first!-1/c.last!));
    if(c.caption) { assert.ok(caption.includes(`${c.first} K`),caption);assert.ok(caption.includes(`${c.last} K`),caption); }
  } else if(c.kind==="half") sceneNear(document.quantities.find(q=>q.id==="t_half")?.value,c.half!);
  else if(c.kind==="energy") sceneNear(document.quantities.find(q=>q.id==="Ea")?.value,c.energy!);
  else if(c.kind==="titration") {
    // The exact source pK must reach the compiled half-equivalence label and full caption.
    const m=/(?:pKa|pKb) = ([0-9.]+)/.exec(caption);assert.ok(m,caption);
    assert.ok(Math.abs(Number(m[1])-c.pK!)<=0.005,caption);
    if(!c.base)assert.ok(labels.some(t=>/pK_a =/.test(t)),JSON.stringify(labels));
  } else if(c.label) assert.ok(labels.includes(c.label),JSON.stringify(labels));
  if(c.captionIncludes)assert.ok(caption.includes(c.captionIncludes),caption);
  for(const label of c.extraLabels??[])assert.ok(labels.includes(label),JSON.stringify(labels));
  if(c.kind==="no-apparent")assert.ok(!labels.some(t=>/M'|Mapp/.test(t)),JSON.stringify(labels));
}
const rows:Array<{id:string;passed:boolean;error?:string}>=[];
for(const c of cases) {
  try {
    const kinetics=/temperature|half|energy|equilibrium|refuse-kinetics/.test(c.kind);
    const titration=/titration|raoult/.test(c.kind);
    const direct=kinetics?buildKineticsScene(c.question,[],false):titration?buildSolutionsGraphScene(c.question,[],false):buildSolutionLessonScene(c.question,[],false);
    const ordinary=synthesizeFamilyScene({question:c.question,turnPlan:undefined});
    if(c.kind==="no-organic") {assert.notEqual(ordinary?.document.source.chemistryFamily,"chem_organic");}
    else if(c.kind.startsWith("refuse")) {assert.equal(direct,null);assert.equal(ordinary,null);}
    else {
      if(c.require)assert.ok(direct,"required known readable case declined");
      if(direct)checkDocument(c,direct);
      if(ordinary)checkDocument(c,ordinary.document);
      if(kinetics) {
        const spec=kineticsFromStem(c.question);
        if(spec && direct) {
          const solution=solveKinetics(spec);
          if(c.kind==="half")near(solution.tHalf,c.half!);
          if(c.kind==="temperature")near(solution.Ea,8.314*Math.log(c.ratio!)/(1/c.first!-1/c.last!));
          if(c.kind==="energy")near(solution.Ea,c.energy!);
        }
      }
    }
    rows.push({id:c.id,passed:true});
  } catch(error) {rows.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
}
console.log(JSON.stringify({total:rows.length,passed:rows.filter(r=>r.passed).length,rows},null,2));
if(rows.some(r=>!r.passed))process.exitCode=1;
