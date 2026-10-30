/**
 * `DIAGRAM_DOUBT_POINTING`: what a student sees change live when a doubt
 * points at the figure on the board. Off unless set to `on`.
 *
 * On, a doubt's prompt walks through the named parts, may leave a kept ring
 * (`[FOCUS:id|keep]`), may letter a withheld measurement (`[ANNOTATE:id]`),
 * and on a code lesson board may spotlight the cells of the frame on the
 * board. Off, the doubt prompt and the live doubt filter are exactly as they
 * were. The flag is granted per turn through begin-turn, like
 * `REFERENCE_PICTURE_PART_FOCUS`, so a turn keeps the answer it started with.
 *
 * Saving a doubt's pointing against the lesson's figure is not behind this
 * flag: it only makes replay match what live already drew.
 */
export function resolveDoubtPointingEnabled(raw = process.env.DIAGRAM_DOUBT_POINTING): boolean {
  return raw?.trim().toLowerCase() === "on";
}
