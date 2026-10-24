/**
 * The pv_cycle archetype draws a cycle at display values from the named
 * process kinds alone. For a stem that states the states' coordinates and
 * gives a straight leg, it drew A→B isobaric and B→C isochoric at made up
 * values, ignored the stated numbers and left out the straight leg (review
 * of #270). It now declines when the stem states any number, a ratio word or
 * a state written A(...), names a leg it cannot draw, writes a leg before
 * its kind, leaves a named leg or the closing leg out, or states a direction
 * the solved cycle contradicts. Stems from the #290 review.
 * The stems are written for this gate.
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
]
for (const question of declineStems) check(pvCycle(question) === null, `pv_cycle drew a cycle that ignores the stem: "${question.slice(0, 70)}"`);

const named = "An ideal gas is taken through a cycle: isobaric expansion from A to B, isochoric cooling B to C, and isothermal compression C to A. Draw the P-V diagram and find the work done in one cycle.";
check(pvCycle(named) !== null, "a cycle named leg by leg with no stated values must still draw");
const carnot = "A Carnot engine works between isothermal expansion A to B, adiabatic expansion B to C, isothermal compression C to D and adiabatic compression D to A. Draw the P-V diagram.";
check(pvCycle(carnot) !== null, "the Carnot cycle named leg by leg must still draw");

console.log(`pv cycle stated values: ${declineStems.length} stems decline; the named cycle and the Carnot cycle still draw`);
