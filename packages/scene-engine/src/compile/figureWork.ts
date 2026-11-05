/**
 * What one compile may spend. Each budget is a count, so a figure never depends
 * on the clock. Every real figure stays well under all of them.
 */

/** Characters one compile may pass to the ink measure. */
export const LABEL_MEASURE_CHAR_BUDGET = 200_000;
/** Overlap tests one compile may run, across every layout and lane check. */
export const LABEL_OVERLAP_WORK_BUDGET = 48_000_000;
/** Points one compile may hold, across every construction and primitive. */
export const FIGURE_POINT_BUDGET = 16_384;
/** Steps one compile may spend evaluating expressions. */
export const EXPRESSION_STEP_BUDGET = 16_000_000;

export interface LabelWork {
  measuredChars: number;
  overlaps: number;
  points: number;
  expressionSteps: number;
  spent: "label_measure_budget" | "label_overlap_budget" | "figure_point_budget" | "expression_step_budget" | null;
}

class LabelWorkSpent extends Error {}

let activeLabelWork: LabelWork | null = null;

const stop = (work: LabelWork, code: NonNullable<LabelWork["spent"]>): never => {
  work.spent ??= code;
  throw new LabelWorkSpent();
};

export function chargeLabelOverlaps(count: number): void {
  const work = activeLabelWork;
  if (!work) return;
  work.overlaps += count;
  if (work.overlaps > LABEL_OVERLAP_WORK_BUDGET) stop(work, "label_overlap_budget");
}

export function chargeMeasuredChars(count: number, budget: number): void {
  const work = activeLabelWork;
  if (!work) return;
  work.measuredChars += count;
  if (work.measuredChars > budget) stop(work, "label_measure_budget");
}

export function chargeFigurePoints(count: number): void {
  const work = activeLabelWork;
  if (!work) return;
  work.points += count;
  if (work.points > FIGURE_POINT_BUDGET) stop(work, "figure_point_budget");
}

export function chargeExpressionSteps(count: number): void {
  const work = activeLabelWork;
  if (!work) return;
  work.expressionSteps += count;
  if (work.expressionSteps > EXPRESSION_STEP_BUDGET) stop(work, "expression_step_budget");
}

/** True when a budget stopped the work. A compile refuses the figure when it sees this. */
export function isLabelWorkSpent(error: unknown): boolean {
  return error instanceof LabelWorkSpent;
}

/** Stops the work once a budget is spent, however an earlier stop was handled on its way up. */
export function stopIfWorkSpent(): void {
  if (activeLabelWork?.spent) throw new LabelWorkSpent();
}

/** Which budget stopped the current work. */
export function spentLabelWorkCode(): NonNullable<LabelWork["spent"]> {
  return activeLabelWork?.spent ?? "label_overlap_budget";
}

/** Every layout inside `run` shares one budget. Nested calls share the outer one. */
export function withSharedLabelWork<T>(run: () => T, start: Partial<LabelWork> = {}): { value: T; work: LabelWork } {
  const outer = activeLabelWork;
  const work = outer ?? { measuredChars: 0, overlaps: 0, points: 0, expressionSteps: 0, spent: null, ...start };
  activeLabelWork = work;
  try {
    return { value: run(), work };
  } finally {
    activeLabelWork = outer;
  }
}

/** Points held by a geometry value, however it nests them. */
export function countFigurePoints(value: unknown, depth = 0): number {
  if (depth > 4 || typeof value !== "object" || value === null) return 0;
  if (Array.isArray(value)) {
    const first = value[0] as { x?: unknown } | undefined;
    if (typeof first === "object" && first !== null && typeof first.x === "number") return value.length;
    let count = 0;
    for (const entry of value) count += countFigurePoints(entry, depth + 1);
    return count;
  }
  const point = value as { x?: unknown; y?: unknown };
  if (typeof point.x === "number" && typeof point.y === "number") return 1;
  let count = 0;
  for (const entry of Object.values(value)) if (typeof entry === "object" && entry !== null) count += countFigurePoints(entry, depth + 1);
  return count;
}
