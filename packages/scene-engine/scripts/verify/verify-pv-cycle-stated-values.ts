/**
 * The pv_cycle archetype draws a cycle at display values from the named
 * process kinds alone. For a stem that states the states' coordinates and
 * gives a straight leg, it drew A→B isobaric and B→C isochoric at made up
 * values, ignored the stated numbers and left out the straight leg (review
 * of #270). It now declines when the stem states any number, a ratio word or
 * a state written A(...), names a leg it cannot draw, writes a leg before
 * its kind, leaves a named leg or the closing leg out, or states a direction
 * the solved cycle contradicts. Kinds listed beside a chain of states, with
 * no leg named for each, decline too: pairing them by order is a guess.
 * Every leg the stem writes must be claimed by a kind the parser reads; a
 * leg written before its kind, or a kind written as an adverb ("expands
 * isobarically") or as "constant pressure", declines rather than rotating
 * labels or dropping the leg (#290 delta review).
 * The next round still found wrong cycles (a direction read from the wrong
 * quantity, a return leg named without a kind word), so pv_cycle now always
 * declines and every stem here, including the named and Carnot cycles, must
 * get no figure.
 * Stems from the #290 review. The stems are written for this gate.
 */
import { attemptArchetypeScene } from "../../src";

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
const pvCycle = (question: string) => {
  const attempt = attemptArchetypeScene({ question });
  return attempt.match?.id === "pv_cycle" ? attempt.scene : null;
};

const declineStems = [
  "A gas runs A→B→C→A with A=(0.010 m^3,100 kPa), B=(0.030 m^3,100 kPa) and C=(0.030 m^3,300 kPa). A→B is isobaric, B→C is isochoric and C→A is a straight line on the P-V plane. Sketch the cycle.",
  "A gas goes A→B→C→A on a P-V diagram: A→B isobaric, B→C isochoric. Find the work.",
  "An ideal gas at 200 kPa expands isothermally from A to B and is then compressed isobarically from B to C. Draw the P-V diagram.",
  "One mole of gas expands isobarically from A to B, from 2.0 L to 6.0 L, and then cools isochorically from B to C. Draw the P-V diagram.",
  "On a P-V diagram a gas goes from A to B along a straight line, then isochorically from B to C, then isobarically from C to A.",
  "A gas is taken through the cycle A→B (isobaric), B→C (isochoric), C→A (isothermal), and find the heat absorbed in A→B. Draw the P-V diagram.",
  "In the cycle A→B is isothermal, B→C is isobaric, C→A is isochoric, find the work for B→C on the P-V diagram.",
  "An ideal gas undergoes a cycle on a P-V diagram: A→B is isobaric, B→C is isochoric and C→A is isothermal.",
  "An ideal gas undergoes isobaric expansion A to B, isochoric heating B to C, and isothermal compression C to A. Draw the P-V diagram.",
  "A gas undergoes the cycle A→B→C→D→A: isobaric, isochoric, isobaric, isochoric. Draw the P-V diagram.",
  "An ideal gas at 2 atm undergoes isobaric expansion from A to B then isochoric cooling B to C and isothermal compression C to A. Draw the P-V diagram.",
  "An ideal gas with volume 3 litres undergoes isobaric expansion from A to B then isochoric cooling B to C and isothermal compression C to A. Draw the P-V diagram.",
  "An ideal gas undergoes isobaric expansion from A to B at 1.0 x 10^5 N/m^2 then isochoric cooling B to C and isothermal compression C to A. Draw the P-V diagram.",
  "An ideal gas undergoes isobaric expansion from A to B where the volume doubles, isochoric cooling B to C, and isothermal compression C to A. Draw the P-V diagram.",
  "An ideal gas undergoes isobaric expansion from A to B, isochoric cooling B to C, isothermal compression C to A. Heat of 500 J is supplied in A to B. Draw the P-V diagram.",
  "An ideal gas goes through A→B (isobaric), B→C (isochoric) and C→A (isothermal), find the net work done in the cycle A→B→C→A.",
  "An ideal gas is taken through a cycle in which A→B is isobaric, B→C is isochoric and C→A is isothermal, so draw the P-V diagram for A→B→C→A.",
  "An ideal gas undergoes isobaric expansion from A to B, from 200 mL to 400 mL, then isochoric cooling from B to C and isothermal compression from C to A. Draw the P-V diagram.",
  "A gas goes through cycle A→B→C→A on a P-V diagram. There is isobaric expansion from A to B and isochoric cooling from B to C. Find the work in the cycle.",
  "An ideal gas undergoes isobaric expansion from A to B at 1.0 x 10^5 N/m^2, then isochoric cooling from B to C and isothermal compression from C to A. Draw the P-V diagram.",
  "A gas goes from state A(V0, P0) by isobaric expansion from A to B to B(2V0, P0), then isochoric cooling from B to C and isothermal compression from C to A. Draw the P-V diagram.",
  "An ideal gas undergoes isobaric expansion from A to B at 76 cm of Hg, then isochoric cooling from B to C and isothermal compression from C to A. Draw the P-V diagram.",
  "A gas undergoes the cycle A→B→C→A. The processes are isobaric, isochoric and adiabatic. Draw the P-V diagram.",
  "An ideal gas goes round A→B→C→D→A. Its four processes are isothermal, adiabatic, isothermal and adiabatic. Draw the P-V diagram.",
  "From A to B the process is isobaric, from B to C it is isochoric, and from C to A it is isothermal, so find the work in A to B. Draw the P-V diagram.",
  "The gas expands isobarically from A to B, then isochoric cooling from B to C, then isothermal compression from C to A. Draw the P-V diagram.",
  "An ideal gas undergoes isobaric expansion from A to B followed by isochoric cooling from B to C and then returns to A isothermally. Draw the P-V diagram.",
  "The gas is first compressed adiabatically from A to B and then undergoes isobaric expansion from B to C and isochoric cooling from C to A. Draw the P-V diagram.",
  "An ideal gas undergoes an isothermal process in which the pressure increases from A to B, then an isobaric process from B to C, then an isochoric process from C to A. Draw the P-V diagram.",
  "An ideal gas undergoes an adiabatic process in which the pressure increases from A to B, then an isochoric process from B to C, then an isobaric process from C to A. Draw the P-V diagram.",
  "An ideal gas undergoes an adiabatic process in which the temperature increases from A to B, then an isobaric process from B to C, then an isochoric process from C to A. Draw the P-V diagram.",
  "An ideal gas undergoes an isochoric process in which heat is removed from A to B, then an isobaric process from B to C, then an isothermal process from C to A. Draw the P-V diagram.",
  "An ideal gas undergoes isobaric compression, rejecting heat, from A to B, then an isochoric process from B to C, then an isothermal process from C to A. Draw the P-V diagram.",
  "An ideal gas undergoes adiabatic compression with no heat exchange from A to B, then an isobaric process from B to C, then an isochoric process from C to A. Draw the P-V diagram.",
  "An ideal gas undergoes an isobaric contraction from A to B, then an isochoric process from B to C, then an isothermal process from C to A. Draw the P-V diagram.",
  "An ideal gas undergoes an isobaric process from A to B in which the gas is compressed, then an isochoric process from B to C, and an isothermal process from C to A. Draw the P-V diagram.",
  "An ideal gas undergoes an isothermal process in which the pressure decreases from A to B, then an isochoric process from B to C, then an isobaric process from C to A. Draw the P-V diagram.",
  "An ideal gas undergoes isobaric expansion from A to B, then isochoric cooling from B to C, and is then compressed back to A, keeping its temperature constant. Draw the P-V diagram.",
  "An ideal gas undergoes isobaric expansion from A to B, then isochoric cooling from B to C, and then returns to A by a constant-temperature compression. Draw the P-V diagram.",
  "An ideal gas undergoes isobaric expansion from A to B, then isochoric cooling from B to C, and then returns to A at constant T. Draw the P-V diagram.",
  "An ideal gas undergoes isochoric heating from A to B, then isothermal expansion from B to C, and then returns to A at fixed pressure. Draw the P-V diagram.",
  "An ideal gas undergoes isobaric expansion from A to B, isochoric cooling from B to C and a non-isothermal compression from C to A. Draw the P-V diagram.",
  "An ideal gas undergoes an isochoric pressure drop from A to B, then an isobaric process from B to C, then an isothermal process from C to A. Draw the P-V diagram.",
  "An ideal gas undergoes isobaric expansion from A to B, then isochoric cooling from B to C, and is then brought back to A with no heat exchange. Draw the P-V diagram.",
]
for (const question of declineStems) check(pvCycle(question) === null, `pv_cycle drew a cycle that ignores the stem: "${question.slice(0, 70)}"`);

// The stop rule (#290 delta 2): ordinary wording kept drawing wrong cycles
// after every heuristic round, so pv_cycle always declines. The named cycle
// and the Carnot cycle, which it used to draw correctly, decline too.
const named = "An ideal gas is taken through a cycle: isobaric expansion from A to B, isochoric cooling B to C, and isothermal compression C to A. Draw the P-V diagram and find the work done in one cycle.";
check(pvCycle(named) === null, "pv_cycle always declines, even a cycle named leg by leg");
const carnot = "A Carnot engine works between isothermal expansion A to B, adiabatic expansion B to C, isothermal compression C to D and adiabatic compression D to A. Draw the P-V diagram.";
check(pvCycle(carnot) === null, "pv_cycle always declines, even the Carnot cycle");

console.log(`pv cycle stated values: pv_cycle always declines (${declineStems.length} stems, the named cycle and the Carnot cycle)`);
