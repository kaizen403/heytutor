/** Real Gibbs source-temperature ownership regressions; no provider calls. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";

const cases: readonly {id:string; question:string; expected:string; dG:number|null; unit?:string; tEq?:number}[] = [
  {
    "id": "GREPTILE-4244042438",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "GIBBS-REFUSE-1",
    "question": "The temperature is unknown; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "GIBBS-REFUSE-2",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). The temperature is 299 K. Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "GIBBS-REFUSE-3",
    "question": "T = 298 kg; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "GIBBS-REFUSE-4",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). T is unreadable. Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "GIBBS-REFUSE-5",
    "question": "At -1 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at -1 K.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "GIBBS-SUPPORT-1",
    "question": "T = 298 K. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "GIBBS-SUPPORT-2",
    "question": "At 25 °C, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298.15 K.",
    "expected": "required-compile",
    "dG": -10.185000000000002
  },
  {
    "id": "GIBBS-SUPPORT-3",
    "question": "At 300 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). T is 300 K. Draw ΔG versus T and calculate ΔG at 300 K.",
    "expected": "required-compile",
    "dG": -10.0
  },
  {
    "id": "GIBBS-SUPPORT-4",
    "question": "At 298 K, ΔH = 40 kJ/mol and ΔS = 100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": 10.2
  },
  {
    "id": "GIBBS-SUPPORT-5",
    "question": "At 300 K, ΔH = -40 kJ/mol and ΔS = 100 J/(mol K). Draw ΔG versus T and calculate ΔG at 300 K.",
    "expected": "required-compile",
    "dG": -70.0
  },
  {
    "id": "OWN-SUPPORT-1",
    "question": "The temperature equals 298 K. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T; calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-SUPPORT-2",
    "question": "At 3e2 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 300 kelvin.",
    "expected": "required-compile",
    "dG": -10
  },
  {
    "id": "OWN-SUPPORT-3",
    "question": "T IS 300 K. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 300 K.",
    "expected": "required-compile",
    "dG": -10
  },
  {
    "id": "OWN-SUPPORT-4",
    "question": "The temperature is 298.15 K. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 25 °C.",
    "expected": "required-compile",
    "dG": -10.185
  },
  {
    "id": "OWN-SUPPORT-5",
    "question": "At 310 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Temperature: 310 K. Draw ΔG versus T and calculate ΔG at 310 K.",
    "expected": "required-compile",
    "dG": -9
  },
  {
    "id": "OWN-REFUSE-1",
    "question": "At unreadable K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298 K.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFUSE-2",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at unknown.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFUSE-3",
    "question": "Temperature = 298 K; temperature = unknown. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFUSE-4",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). T = 298 K/kg. Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFUSE-5",
    "question": "At 0 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 0 K.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFUSE-6",
    "question": "At 3e- K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298 K.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFUSE-7",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). The temperature is 25 °C. Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFUSE-8",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at ? K.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ABSENT-1",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and show the equilibrium temperature.",
    "expected": "graph-only",
    "dG": null
  },
  {
    "id": "OWN-ABSENT-2",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T at all temperatures.",
    "expected": "graph-only",
    "dG": null
  },
  {
    "id": "OWN-OPTIONS-1",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298 K. Options: (a) at 0 K (b) T=unknown",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "HS-UNREAD-1",
    "question": "ΔH = unknown; ΔH = -40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "HS-UNREAD-2",
    "question": "ΔH = -40 kJ/mol. ΔS = unknown; ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "HS-UNREAD-3",
    "question": "ΔH = -40 kJ/mol; ΔH is unreadable. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "HS-UNREAD-4",
    "question": "ΔH = -40 kJ/mol. ΔS = -100 J/(mol K); ΔS is unreadable. At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "HS-UNREAD-5",
    "question": "ΔH = unknown; ΔH = -40 kJ/mol. ΔS = unknown; ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-1",
    "question": "ΔH of the reaction is unknown, then ΔH of the reaction is -40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-2",
    "question": "The enthalpy change for the reaction is unreadable; the enthalpy change is -40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-3",
    "question": "ΔH = -40 kg; ΔH = -40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-4",
    "question": "ΔH = -40 kJ/mol. ΔS = -100 kg; ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-5",
    "question": "ΔH = -40 kJ/mol; ΔH remains unknown. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-6",
    "question": "ΔH = -40 kJ/mol. ΔS remains unknown; ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-7",
    "question": "ΔH for the reaction is unknown, ΔH for the reaction is -40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-REFUSE-8",
    "question": "ΔH = -40 kJ/mol. Entropy change is unknown, entropy change is -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-HS-SUPPORT-1",
    "question": "ΔH of the reaction is -40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-HS-SUPPORT-2",
    "question": "Enthalpy change for the reaction is -40 kJ/mol. Entropy change = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "GIBBS-FORMULA-SUPPORT-1",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Plot ΔG = ΔH - TΔS versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-FORMULA-SUPPORT-2",
    "question": "At 298 K, enthalpy change = -40 kJ/mol and entropy change = -100 J/(mol K). Draw ΔG versus T using ΔH - TΔS and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-FORMULA-SUPPORT-3",
    "question": "At 298 K, ΔH = 40 kJ/mol and ΔS = 100 J/(mol K). Calculate ΔG from ΔG = ΔH - TΔS and draw ΔG versus T.",
    "expected": "required-compile",
    "dG": 10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-FORMULA-SUPPORT-4",
    "question": "At 300 K, ΔH = -40 kJ/mol and ΔS = 100 J/(mol K). Draw the line ΔG = ΔH - TΔS against T and calculate ΔG at 300 K.",
    "expected": "required-compile",
    "dG": -70,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-FORMULA-SUPPORT-5",
    "question": "At 298 K, ΔH = -40 kJ and ΔS = -100 J/K. Draw ΔG = ΔH - TΔS versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ"
  },
  {
    "id": "GIBBS-THRESHOLD-SUPPORT-1",
    "question": "At what temperature is ΔG zero? ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T.",
    "expected": "graph-only",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-THRESHOLD-SUPPORT-2",
    "question": "At which temperature does the reaction reach equilibrium? ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw the Gibbs energy line versus T.",
    "expected": "graph-only",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-UNREAD-QUALIFIED-1",
    "question": "The temperature remains unknown; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-UNREAD-QUALIFIED-2",
    "question": "The temperature which is unreadable is stated; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-UNREAD-QUALIFIED-3",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at an unknown temperature.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "OWN-THRESHOLD-1",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and determine at what temperature the reaction becomes spontaneous.",
    "expected": "graph-only",
    "dG": null
  },
  {
    "id": "OWN-THRESHOLD-2",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At which absolute temperature is ΔG zero? Draw ΔG versus T.",
    "expected": "graph-only",
    "dG": null
  },
  {
    "id": "OWN-REFERENCE-1",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Plot ΔG(T) = ΔH − T × ΔS versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-REFERENCE-2",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Use ΔH and ΔS to calculate ΔG and draw ΔG versus T.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-TEMPERATURE-OF",
    "question": "The temperature of the reaction is 298 K. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-TEMPERATURE-FOR-UNREAD",
    "question": "The temperature for the reaction is unknown; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFERENCE-NOT-READABLE",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). With ΔH not readable, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFERENCE-UNKNOWN",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Use ΔH = unknown to calculate ΔG and draw ΔG versus T.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-REFERENCE-REDECLARATION",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG = ΔH - TΔS, ΔH is unknown; calculate ΔG at 298 K.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-TEMP-T-UNKNOWN",
    "question": "T was unknown; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "GIBBS-H-ALIAS-REFUSE-1",
    "question": "The reaction releases unknown; the reaction releases 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-H-ALIAS-REFUSE-2",
    "question": "The reaction evolves unknown; the reaction evolves 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-H-ALIAS-REFUSE-3",
    "question": "Heat absorbed is unknown; heat absorbed is 40 kJ/mol. ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-H-ALIAS-REFUSE-4",
    "question": "The reaction is exothermic by unknown; the reaction is exothermic by 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-H-ALIAS-REFUSE-5",
    "question": "The reaction is endothermic with unknown; the reaction is endothermic with 40 kJ/mol. ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-H-ALIAS-SUPPORT-1",
    "question": "The reaction releases heat. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-H-ALIAS-SUPPORT-2",
    "question": "The reaction absorbs heat. ΔH = 40 kJ/mol and ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": 10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-H-ALIAS-SUPPORT-3",
    "question": "The enthalpy change, ΔH = -40 kJ/mol, and the entropy change, ΔS = -100 J/(mol K), are given. At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-H-ALIAS-SUPPORT-4",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Use the enthalpy change ΔH and entropy change ΔS in ΔG = ΔH - TΔS. At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "GIBBS-H-ALIAS-SUPPORT-5",
    "question": "The reaction releases 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-1-SUPPORT",
    "question": "The reaction releases 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-1-UNREAD-FIRST",
    "question": "The reaction releases unknown; The reaction releases 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-1-UNREAD-LAST",
    "question": "The reaction releases 40 kJ/mol; The reaction releases unreadable. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-2-SUPPORT",
    "question": "The reaction evolves 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-2-UNREAD-FIRST",
    "question": "The reaction evolves unknown; The reaction evolves 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-2-UNREAD-LAST",
    "question": "The reaction evolves 40 kJ/mol; The reaction evolves unreadable. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-3-SUPPORT",
    "question": "The reaction liberates 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-3-UNREAD-FIRST",
    "question": "The reaction liberates unknown; The reaction liberates 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-3-UNREAD-LAST",
    "question": "The reaction liberates 40 kJ/mol; The reaction liberates unreadable. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-4-SUPPORT",
    "question": "The heat evolved is 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-4-UNREAD-FIRST",
    "question": "The heat evolved is unknown; The heat evolved is 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-4-UNREAD-LAST",
    "question": "The heat evolved is 40 kJ/mol; The heat evolved is unreadable. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-5-SUPPORT",
    "question": "The heat released is 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-5-UNREAD-FIRST",
    "question": "The heat released is unknown; The heat released is 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-5-UNREAD-LAST",
    "question": "The heat released is 40 kJ/mol; The heat released is unreadable. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-6-SUPPORT",
    "question": "The heat liberated is 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-6-UNREAD-FIRST",
    "question": "The heat liberated is unknown; The heat liberated is 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-6-UNREAD-LAST",
    "question": "The heat liberated is 40 kJ/mol; The heat liberated is unreadable. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-7-SUPPORT",
    "question": "The reaction is exothermic by 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-7-UNREAD-FIRST",
    "question": "The reaction is exothermic by unknown; The reaction is exothermic by 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-7-UNREAD-LAST",
    "question": "The reaction is exothermic by 40 kJ/mol; The reaction is exothermic by unreadable. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-8-SUPPORT",
    "question": "The reaction is exothermic with 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-8-UNREAD-FIRST",
    "question": "The reaction is exothermic with unknown; The reaction is exothermic with 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-8-UNREAD-LAST",
    "question": "The reaction is exothermic with 40 kJ/mol; The reaction is exothermic with unreadable. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-9-SUPPORT",
    "question": "The reaction absorbs 40 kJ/mol. ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": 10.2
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-9-UNREAD-FIRST",
    "question": "The reaction absorbs unknown; The reaction absorbs 40 kJ/mol. ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-9-UNREAD-LAST",
    "question": "The reaction absorbs 40 kJ/mol; The reaction absorbs unreadable. ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-10-SUPPORT",
    "question": "The heat absorbed is 40 kJ/mol. ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": 10.2
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-10-UNREAD-FIRST",
    "question": "The heat absorbed is unknown; The heat absorbed is 40 kJ/mol. ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-10-UNREAD-LAST",
    "question": "The heat absorbed is 40 kJ/mol; The heat absorbed is unreadable. ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-11-SUPPORT",
    "question": "The reaction is endothermic by 40 kJ/mol. ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": 10.2
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-11-UNREAD-FIRST",
    "question": "The reaction is endothermic by unknown; The reaction is endothermic by 40 kJ/mol. ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-11-UNREAD-LAST",
    "question": "The reaction is endothermic by 40 kJ/mol; The reaction is endothermic by unreadable. ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-12-SUPPORT",
    "question": "The reaction is endothermic with 40 kJ/mol. ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": 10.2
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-12-UNREAD-FIRST",
    "question": "The reaction is endothermic with unknown; The reaction is endothermic with 40 kJ/mol. ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-ALIAS-12-UNREAD-LAST",
    "question": "The reaction is endothermic with 40 kJ/mol; The reaction is endothermic with unreadable. ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-SOURCE-ROLE-1",
    "question": "The reaction releases heat. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-ENTHALPY-SOURCE-ROLE-2",
    "question": "The reaction absorbs heat. ΔH = 40 kJ/mol and ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": 10.2
  },
  {
    "id": "OWN-ENTHALPY-SOURCE-ROLE-3",
    "question": "The reaction is exothermic with ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-ENTHALPY-SOURCE-ROLE-4",
    "question": "The reaction is endothermic with ΔH = 40 kJ/mol and ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": 10.2
  },
  {
    "id": "OWN-ENTHALPY-SOURCE-ROLE-5",
    "question": "The reaction releases heat. ΔH = 40 kJ/mol and ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-SOURCE-ROLE-6",
    "question": "ΔH = -40 kJ/mol; the reaction releases 20 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-SOURCE-ROLE-7",
    "question": "ΔH = -40 kJ/mol; the reaction releases 40 kJ. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-ENTHALPY-SOURCE-ROLE-8",
    "question": "ΔH = -40 kJ/mol; the reaction releases 40 kJ/mol. ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-TEMPERATURE-NESTED-AT",
    "question": "At a temperature of 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-TEMPERATURE-NESTED-AT-UNREAD",
    "question": "At a temperature of unknown K; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "QA-TEMP-UNREAD-1",
    "question": "The temperature cannot be read; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "QA-TEMP-UNREAD-2",
    "question": "The temperature not readable; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "QA-TEMP-UNREAD-3",
    "question": "The temperature may be unknown; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "QA-TEMP-UNREAD-4",
    "question": "T cannot be read; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "QA-TEMP-UNREAD-5",
    "question": "The temperature is unavailable; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "QA-ENERGY-REFERENCE-1",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Use the known ΔH and ΔS to calculate ΔG and draw ΔG versus T.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "QA-ENERGY-REFERENCE-2",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Use the stated ΔH and ΔS to calculate ΔG and draw ΔG versus T.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "QA-ENERGY-REFERENCE-3",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Use the observed ΔH and ΔS to calculate ΔG and draw ΔG versus T.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "QA-ENERGY-REFERENCE-4",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Use ΔH together with ΔS to calculate ΔG and draw ΔG versus T.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "OWN-OPAQUE-TEMP-1",
    "question": "The temperatures could not be measured; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-OPAQUE-TEMP-2",
    "question": "The temperature has an unspecified value; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-OPAQUE-TEMP-3",
    "question": "T not readable; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-TEMPERATURE-CHANGE",
    "question": "ΔT = 10 K. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-AXIS-UNIT-REFERENCE",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG against T (K) and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-GIBBS-FUNCTION-REFERENCE",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG(T) = ΔH - TΔS versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-TEMPERATURE-AXIS",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG against temperature and mark the equilibrium temperature.",
    "expected": "graph-only",
    "dG": null
  },
  {
    "id": "OWN-ENERGY-PROVIDED-REFERENCE",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Use the provided ΔH and ΔS to calculate ΔG and draw ΔG versus T.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-REQUESTED-T-REFERENCE",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Find the equilibrium T and draw ΔG versus T.",
    "expected": "graph-only",
    "dG": null
  },
  {
    "id": "OWN-LOWERCASE-TIME-PRESERVED",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). The elapsed time t = 60 s. Draw ΔG versus T and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-UPPERCASE-T-WRONG-DIMENSION",
    "question": "T = 60 s; at 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-CLOSED-negative-1",
    "question": "The reaction releases heat, 50 kJ/mol. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-CLOSED-negative-2",
    "question": "The reaction releases heat, which is unknown; ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-CLOSED-negative-3",
    "question": "The reaction releases energy, whose value cannot be read; ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-CLOSED-negative-4",
    "question": "The reaction absorbs heat, 60 kJ/mol. ΔH = 40 kJ/mol and ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-CLOSED-negative-5",
    "question": "The reaction liberates heat, with an unreadable value; ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-CLOSED-positive-1",
    "question": "The reaction releases heat. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-CLOSED-positive-2",
    "question": "The reaction absorbs heat; ΔH = 40 kJ/mol and ΔS = 100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": 10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-CLOSED-positive-3",
    "question": "The reaction releases heat, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-REFERENCE-CLOSED-1",
    "question": "Use ΔH to be -50 kJ/mol. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-REFERENCE-CLOSED-2",
    "question": "Use the known ΔH and take its value as -50 kJ/mol. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-REFERENCE-CLOSED-3",
    "question": "Use the given enthalpy change to have an unreadable value. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-REFERENCE-CLOSED-4",
    "question": "Use ΔS to be unknown. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-REFERENCE-CLOSED-5",
    "question": "Use the observed ΔS together with its stated value of -200 J/(mol K). ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-REFERENCE-CLOSED-6",
    "question": "Draw ΔG versus T, which is unreadable. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-REFERENCE-CLOSED-7",
    "question": "Draw ΔG against temperature, whose value cannot be read. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-REFERENCE-CLOSED-8",
    "question": "Plot ΔG versus T and treat its value as unknown. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-REFERENCE-CLOSED-9",
    "question": "Sketch ΔG against temperature, recorded as unavailable. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-REFERENCE-CLOSED-10",
    "question": "Draw ΔG against T, with an unknown value. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "INDEPENDENT-GIBBS-REFERENCE-CLOSED-SUPPORT-1",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Use the known ΔH and ΔS to calculate ΔG and draw ΔG versus T.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-REFERENCE-CLOSED-SUPPORT-2",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG(T) = ΔH - TΔS against T (K) and calculate ΔG at 298 K.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-ROLE-refuse-1",
    "question": "Use ΔH as 298 K. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-ROLE-refuse-2",
    "question": "Use ΔS as 298 K. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-ROLE-refuse-3",
    "question": "Use the known enthalpy change as 25 °C. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298.15 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-ROLE-refuse-4",
    "question": "Use the stated entropy change as 3e2 K. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 300 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-ROLE-refuse-5",
    "question": "Use the provided ΔH to be 298 kelvin. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-ROLE-support-1",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Use ΔH and ΔS to calculate ΔG at 298 K and draw ΔG versus T.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-ROLE-support-2",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Use ΔH and T = 298 K with ΔS to calculate ΔG and draw ΔG versus T.",
    "expected": "required-compile",
    "dG": -10.2,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-ROLE-support-3",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Use the known ΔS to calculate ΔG at 25 °C and draw ΔG versus T.",
    "expected": "required-compile",
    "dG": -10.185,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-ROLE-threshold-1",
    "question": "At which temperature does the reaction reach equilibrium? ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw the Gibbs energy line versus T.",
    "expected": "graph-only",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-ROLE-threshold-2",
    "question": "At what temperature will the reaction become spontaneous? ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T.",
    "expected": "graph-only",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-ROLE-threshold-3",
    "question": "At what absolute temperature is Gibbs free energy zero? ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T.",
    "expected": "graph-only",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "INDEPENDENT-GIBBS-ROLE-threshold-4",
    "question": "At which temperature will this reaction reach the equilibrium point? ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Show the Gibbs energy curve against T.",
    "expected": "graph-only",
    "dG": null,
    "unit": "kJ/mol"
  },
  {
    "id": "OWN-LOWERCASE-TIME-REFERENCE-WRONG-UNIT",
    "question": "Use ΔH and t = 298 K. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, draw ΔG versus T and calculate ΔG.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-EMPTY-AXIS-SEMICOLON",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T; calculate the Gibbs energy.",
    "expected": "required-compile",
    "dG": -10.2
  },
  {
    "id": "OWN-EMPTY-AXIS-END",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw the Gibbs energy curve against T",
    "expected": "graph-only",
    "dG": null
  },
  {
    "id": "OWN-EMPTY-FORMULA-END",
    "question": "At 300 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw the Gibbs line using ΔG = ΔH - TΔS.",
    "expected": "required-compile",
    "dG": -10
  },
  {
    "id": "OWN-EMPTY-UNREAD-T",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). T; draw ΔG versus T.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-EMPTY-UNREAD-H",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). ΔH; draw ΔG versus T.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-EMPTY-AXIS-CONFLICT",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T; T = 299 K.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-CAPTION-OPPOSITE-SIGNS",
    "question": "At 310 K, ΔH = -40 kJ/mol and ΔS = 100 J/(mol K). Draw ΔG versus T.",
    "expected": "required-compile",
    "dG": -71
  },
  {
    "id": "OWN-PLURAL-AXIS-REFERENCE",
    "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Show Gibbs free energy against T at every temperature.",
    "expected": "graph-only",
    "dG": null
  },
  {
    "id": "OWN-PLURAL-UNREAD-OWNER",
    "question": "The temperatures are unknown. ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K, show Gibbs free energy against T.",
    "expected": "decline",
    "dG": null
  },
  {
    "id": "OWN-GIBBS-ACTIVATION-UNREAD",
    "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Activation energy is unknown; draw Gibbs free energy against T.",
    "expected": "required-compile",
    "dG": -10.2
  },
{
  "id": "PUBLIC-LANEB-M10d",
  "question": "For a reaction ΔH = 100000 kJ/mol and ΔS = 100 J K−1 mol−1. Draw ΔG vs T and find the temperature where ΔG = 0.",
  "expected": "graph-only",
  "dG": null,
  "tEq": 1000000
},
{
  "id": "OWN-IMPLICIT-USING",
  "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T using ΔH - TΔS and calculate ΔG at 298 K.",
  "expected": "required-compile",
  "dG": -10.2
},
{
  "id": "OWN-IMPLICIT-FROM",
  "question": "At 300 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Plot ΔG against T from ΔH - TΔS.",
  "expected": "required-compile",
  "dG": -10
},
{
  "id": "OWN-IMPLICIT-WITH",
  "question": "At 310 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Show ΔG versus T with ΔH - TΔS.",
  "expected": "required-compile",
  "dG": -9
},
{
  "id": "OWN-ZERO-CONDITION",
  "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Find the temperature where ΔG = 0.",
  "expected": "graph-only",
  "dG": null
},
{
  "id": "OWN-ZERO-CONDITION-PLOT",
  "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and mark the temperature where ΔG = 0.",
  "expected": "graph-only",
  "dG": null
},
{
  "id": "OWN-IMPLICIT-UNREAD",
  "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T using ΔH - TΔS and T is unknown.",
  "expected": "decline",
  "dG": null
},
{
  "id": "OWN-IMPLICIT-WRONG-UNIT",
  "question": "At 298 K, ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T using ΔH as 298 K.",
  "expected": "decline",
  "dG": null
},
{
  "id": "OWN-ZERO-CONDITION-UNIT",
  "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Draw ΔG versus T and find the temperature where ΔG = 0 K.",
  "expected": "decline",
  "dG": null
},
{
  "id": "OWN-ZERO-CONDITION-NONZERO",
  "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Find the temperature where ΔG = 1.",
  "expected": "decline",
  "dG": null
},
{
  "id": "OWN-ZERO-CONDITION-DECIMAL",
  "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Find the temperature where ΔG = 0.5.",
  "expected": "decline",
  "dG": null
},
{
  "id": "OWN-ZERO-CONDITION-UNREAD",
  "question": "ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). Find the temperature where ΔG = unknown.",
  "expected": "decline",
  "dG": null
}
];
const results: {id:string;passed:boolean;error?:string}[] = [];
function compiled(document: SceneDocument | null, expected: number | null, unit = "kJ/mol", expectedTeq = 400): void {
  assert.ok(document, "required original Gibbs scene missing");
  assert.equal(document.source.chemistryFamily, "chem_thermo");
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  const dG = document.quantities.find(quantity => quantity.id === "dG");
  const labels = result.renderScene.primitives.flatMap(mark => mark.text ? [mark.text] : []);
  // Gibbs draws H/S/T authority only. An unrelated unavailable activation
  // energy must never create an Ea quantity, mark or caption assertion.
  assert.ok(document.quantities.every(quantity => !/^(?:E_?a|activation)/i.test(quantity.id)));
  assert.ok(!/activation\s+energy|\bE_?a\b/i.test([...labels, result.renderScene.caption ?? ""].join(" ")));
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(document)));
  if (expected === null) {
    assert.equal(dG, undefined, "graph-only source cannot invent an evaluation point");
    assert.ok(document.quantities.some(quantity => quantity.id === "T_eq" && quantity.value === expectedTeq));
  } else {
    assert.ok(dG && typeof dG.value === "number");
    assert.ok(Math.abs(dG.value - expected) <= 1e-10, `${dG.value} != ${expected}`);
    assert.equal(dG.unit, unit);
    assert.ok(labels.some(label => label.replace(/\s+/g, "").includes(`ΔG=${expected.toFixed(1)}`)), JSON.stringify(labels));
    assert.ok(result.renderScene.caption?.includes(`ΔG=${expected.toFixed(1)} ${unit}`), result.renderScene.caption);
  }
}
for (const row of cases) {
  try {
    const direct = buildThermoGraphScene(row.question, [], false);
    const schematic = buildThermoGraphScene(row.question, [], true);
    const ordinary = synthesizeFamilyScene({question: row.question});
    if (row.expected === "decline") {
      assert.equal(direct, null, "invalid supplied temperature cannot render direct graph");
      assert.equal(schematic, null, "invalid temperature cannot render schematic graph");
      assert.equal(ordinary, null, "invalid temperature cannot fall through to another family");
    } else {
      compiled(direct, row.dG, row.unit, row.tEq); compiled(schematic, row.dG, row.unit, row.tEq);
      assert.ok(ordinary); compiled(ordinary.document, row.dG, row.unit, row.tEq);
      assert.equal(ordinary.document.source.question, row.question);
    }
    results.push({id:row.id,passed:true}); console.log(`PASS ${row.id}`);
  } catch (error) { results.push({id:row.id,passed:false,error:String(error)}); console.error(`FAIL ${row.id}: ${String(error)}`); }
}
const output = process.argv[2]; if (output) writeFileSync(output, JSON.stringify({cases:cases.length,passed:results.filter(row=>row.passed).length,results},null,2)+"\n");
console.log(`${results.filter(row=>row.passed).length}/${cases.length} Gibbs temperature ownership cases passed`);
process.exitCode = results.some(row=>!row.passed) ? 1 : 0;
