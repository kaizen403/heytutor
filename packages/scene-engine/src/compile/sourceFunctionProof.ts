import type { RenderPoint } from "../types";
import { exactRationalToNumber } from "../math/exactRational";
import { mathExpressionsEquivalent } from "../math/expression";
import { parseLinearAffine } from "../math/linearRegion";
import type { ConicDefinition } from "./conicGeometry";

/** Prove the complete conic, not a fit to its sampled display points. */
export function conicMatchesSourceFunction(conic: ConicDefinition, expression: string): boolean {
  if (conic.kind !== "parabola") return false;
  const quarterTurns = conic.rotationRad / (Math.PI / 2);
  // Only a vertical parabola is a single-valued explicit function of x.
  if (!Number.isInteger(quarterTurns) || Math.abs(quarterTurns % 2) !== 1) return false;
  const direction = quarterTurns % 4 === 1 || quarterTurns % 4 === -3 ? 1 : -1;
  // Local coordinates are (p*t², 2*p*t). Keep arithmetic in the exact
  // expression prover instead of rounding a derived quadratic coefficient.
  const body = `(${conic.origin.y})+(x-(${conic.origin.x}))^2/(4*(${conic.p})*(${direction}))`;
  return mathExpressionsEquivalent(body, expression);
}

/** The caller proves affine geometry; two endpoints then prove its whole equation. */
export function lineMatchesCartesianEquation(points: readonly RenderPoint[], equation: { lhs: string; rhs: string }): boolean {
  const affine = parseLinearAffine(`(${equation.lhs})-(${equation.rhs})`);
  const a = exactRationalToNumber(affine.a), b = exactRationalToNumber(affine.b), c = exactRationalToNumber(affine.constant);
  const norm = Math.hypot(a, b);
  if (!Number.isFinite(norm) || norm === 0 || !Number.isFinite(c) || points.length < 2) return false;
  return [points[0]!, points.at(-1)!].every(point => {
    const distance = Math.abs((a * point.x + b * point.y + c) / norm);
    return Number.isFinite(distance) && distance <= 1e-6;
  });
}
