/**
 * The pv_cycle archetype draws a cycle at display values from the named
 * process kinds alone. For a stem that states the states' coordinates and
 * gives a straight leg, it drew A→B isobaric and B→C isochoric at made up
 * values, ignored the stated numbers and left out the straight leg (review
 * of #270). It now declines when the stem states P or V values, names a leg
 * it cannot draw, or names a different number of kinds than it has legs.
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

for (const question of [
  "A gas runs A→B→C→A with A=(0.010 m^3,100 kPa), B=(0.030 m^3,100 kPa) and C=(0.030 m^3,300 kPa). A→B is isobaric, B→C is isochoric and C→A is a straight line on the P-V plane. Sketch the cycle.",
  "A gas goes A→B→C→A on a P-V diagram: A→B isobaric, B→C isochoric. Find the work.",
  "An ideal gas at 200 kPa expands isothermally from A to B and is then compressed isobarically from B to C. Draw the P-V diagram.",
  "One mole of gas expands isobarically from A to B, from 2.0 L to 6.0 L, and then cools isochorically from B to C. Draw the P-V diagram.",
  "On a P-V diagram a gas goes from A to B along a straight line, then isochorically from B to C, then isobarically from C to A.",
]) check(pvCycle(question) === null, `pv_cycle drew a cycle that ignores the stem: "${question.slice(0, 70)}"`);

const named = "An ideal gas is taken through a cycle: isobaric expansion from A to B, isochoric cooling B to C, and isothermal compression C to A. Draw the P-V diagram and find the work done in one cycle.";
check(pvCycle(named) !== null, "a cycle named leg by leg with no stated values must still draw");

console.log("pv cycle stated values: 5 stems that state values, a straight leg or unmatched kinds decline; a fully named cycle still draws");
