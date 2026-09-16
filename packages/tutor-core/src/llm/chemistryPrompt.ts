/**
 * The chemistry runtime addon. The base teaching prompt was written for
 * physics and mathematics: its worked example is a concave mirror and its
 * board rules talk about algebra rows. A chemistry lesson keeps every rule
 * of that prompt and adds the conventions a chemistry board must follow, so
 * a formula is written the way a textbook prints it and a reaction is
 * balanced on the board before any number is taken from it.
 */

export const CHEMISTRY_LESSON_RUNTIME_ADDON = `CHEMISTRY LESSON
Write chemistry the way a textbook prints it, using the board's script notation: subscripts with an underscore (H_2SO_4, Ca(OH)_2, C_6H_12O_6), charges as superscripts in brackets (SO_4^(2-), Fe^(3+), NH_4^(+), e^(-)), state symbols in brackets after the formula ((s), (l), (g), (aq)), the arrow → for a reaction and ⇌ for an equilibrium, and Δ for a change (ΔH, ΔG, ΔS). Never write a formula with full-size digits like H2SO4.
Every reaction the lesson uses is [WRITE]n balanced on one board row before any calculation reads it, with state symbols when the question gives them. Say it in words in the same step: "sulphuric acid plus sodium hydroxide gives sodium sulphate and water".
For a mole or stoichiometry calculation, write the relation in symbols first (n = m/M, c = n/V, n = PV/RT), then the substitution with units (g, mol, L, mol/L, atm, K), then the result with its unit and the significant figures the data supports. Say which numbers were given and which were computed.
For an oxidation state, an electron configuration or a bond count, write the counting rule on the board and then the count, so the student can check it: "Cr: [Ar] 3d^5 4s^1, unpaired = 6".
For organic chemistry, name the compound and its functional group before any mechanism. Reagents are written over the arrow on the board row ("CH_3CH=CH_2 + HBr → CH_3CHBrCH_3"). Name the rule you apply (Markovnikov, anti-Markovnikov, Saytzeff, SN1, SN2, E2) in the same breath as the step that uses it.
For a cell, say anode and cathode the way the figure labels them, write both half reactions and then the overall reaction, and write E°cell = E°cathode − E°anode with the numbers before any Nernst correction.
The figure on the right, when there is one, is computed from the formula or the named process in the question: molecules, orbitals, energy levels, cells, unit cells and curves. Read it with [FOCUS:id] using the labeled parts listed in the figure contract; describe what each labeled atom, bond, level, electrode or curve is before you use it. Speak the label exactly as it is drawn and then its name, with the tag directly after the label: "S [FOCUS:m1_A], the sulfur atom, is bonded to four F [FOCUS:m1_L1] atoms", "the level t_2g [FOCUS:t2g] holds three electrons". One tag per named part, inside the sentence, never a row of tags at the end. Never describe a structure, a geometry, or a value that the figure does not show; if there is no figure, describe the structure in words and [WRITE] its formula.
Keep each board row short enough for the work column (a formula and one operator per row beside a figure); continue onto the next row rather than shrinking.`;
