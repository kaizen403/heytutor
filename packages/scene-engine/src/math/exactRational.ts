/** Reduced source-rational arithmetic. Bigints never cross the JSON interface. */
export interface ExactRational { numerator: string; denominator: string }
export interface Rational { n: bigint; d: bigint }
export const RATIONAL_MAX_BITS = 4096;
export class ExactRationalError extends Error {}
export const Q_ZERO: Rational = { n: 0n, d: 1n };
export const Q_ONE: Rational = { n: 1n, d: 1n };
function bits(value: bigint): number { return (value < 0n ? -value : value).toString(2).length; }
export function rational(n: bigint, d = 1n): Rational {
  if (d === 0n) throw new ExactRationalError('Zero rational denominator');
  if (bits(n) > RATIONAL_MAX_BITS * 2 || bits(d) > RATIONAL_MAX_BITS * 2) throw new ExactRationalError('Exact arithmetic exceeds capacity');
  if (n === 0n) return Q_ZERO;
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n; let b = d;
  while (b) { const next = a % b; a = b; b = next; }
  const result = { n: n / a, d: d / a };
  if (bits(result.n) > RATIONAL_MAX_BITS || bits(result.d) > RATIONAL_MAX_BITS) throw new ExactRationalError('Exact arithmetic exceeds 4096 bits');
  return result;
}
export function addRational(a: Rational, b: Rational): Rational { return rational(a.n * b.d + b.n * a.d, a.d * b.d); }
export function negateRational(a: Rational): Rational { return { n: -a.n, d: a.d }; }
export function subtractRational(a: Rational, b: Rational): Rational { return addRational(a, negateRational(b)); }
export function multiplyRational(a: Rational, b: Rational): Rational { return rational(a.n * b.n, a.d * b.d); }
export function divideRational(a: Rational, b: Rational): Rational { return rational(a.n * b.d, a.d * b.n); }
export function compareRational(a: Rational, b: Rational): -1 | 0 | 1 {
  const difference = a.n * b.d - b.n * a.d;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
export function serializeRational(value: Rational): ExactRational { return { numerator: value.n.toString(), denominator: value.d.toString() }; }
export function deserializeRational(value: ExactRational): Rational {
  if (typeof value !== 'object' || value === null || Object.keys(value).length !== 2 ||
      typeof value.numerator !== 'string' || typeof value.denominator !== 'string' ||
      value.numerator.length > 1250 || value.denominator.length > 1250 ||
      !/^-?(?:0|[1-9]\d*)$/.test(value.numerator) || !/^[1-9]\d*$/.test(value.denominator)) throw new ExactRationalError('Invalid exact rational metadata');
  const n = BigInt(value.numerator); const d = BigInt(value.denominator); const result = rational(n, d);
  if (result.n.toString() !== value.numerator || result.d.toString() !== value.denominator) throw new ExactRationalError('Exact rational metadata must be canonical and reduced');
  return result;
}
export function parseRational(value: string | number): Rational {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new ExactRationalError('Nonfinite rational source');
  const text = String(value).trim();
  if (text.length > 512) throw new ExactRationalError('Rational literal exceeds capacity');
  const fraction = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(text);
  if (fraction) return rational(BigInt(fraction[1]!), BigInt(fraction[2]!));
  const decimal = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i.exec(text);
  if (!decimal) throw new ExactRationalError('Expected exact decimal or fraction literal');
  const exponent = Number(decimal[3] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1024) throw new ExactRationalError('Rational decimal exponent exceeds capacity');
  const [whole, fractionPart = ''] = decimal[2]!.split('.');
  const n = BigInt((whole || '0') + fractionPart) * (decimal[1] === '-' ? -1n : 1n);
  const power = exponent - fractionPart.length;
  return power >= 0 ? rational(n * 10n ** BigInt(power)) : rational(n, 10n ** BigInt(-power));
}
export function exactRationalText(value: ExactRational): string {
  const q = deserializeRational(value);
  return q.d === 1n ? q.n.toString() : `${q.n}/${q.d}`;
}
export function exactRationalToNumber(value: ExactRational): number {
  const q = deserializeRational(value);
  if (q.n === 0n) return 0;
  const n = q.n < 0n ? -q.n : q.n;
  let exponent = bits(n) - bits(q.d);
  // Locate the actual binary exponent, then round once on the binary64 grid.
  // Rounding an intermediate 54-bit significand and coercing it to Number
  // would double-round values such as 1/3 to the wrong adjacent double.
  if (exponent >= 0 ? n < (q.d << BigInt(exponent)) : (n << BigInt(-exponent)) < q.d) exponent--;
  const power = Math.max(exponent - 52, -1074);
  const numerator = power < 0 ? n << BigInt(-power) : n;
  const denominator = power >= 0 ? q.d << BigInt(power) : q.d;
  const quotient = numerator / denominator; const remainder = numerator % denominator;
  const rounded = quotient + (2n * remainder > denominator || 2n * remainder === denominator && quotient % 2n !== 0n ? 1n : 0n);
  const result = Number(rounded) * 2 ** power * (q.n < 0n ? -1 : 1);
  if (!Number.isFinite(result) || result === 0) throw new ExactRationalError('Exact nonzero value exceeds display precision');
  return result;
}
