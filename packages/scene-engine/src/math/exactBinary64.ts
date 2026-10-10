/** Exact dyadic arithmetic over finite binary64 inputs; no decimal reinterpretation. */
export type Dyadic = { n: bigint; power: number };
export function exactBinary64(value: number): Dyadic {
  if (!Number.isFinite(value)) throw new Error("nonfinite binary64 input");
  const data = new DataView(new ArrayBuffer(8)); data.setFloat64(0, value);
  const bits = data.getBigUint64(0), sign = bits >> 63n ? -1n : 1n;
  const exponent = Number((bits >> 52n) & 2047n);
  const fraction = bits & ((1n << 52n) - 1n);
  return { n: (exponent ? fraction + (1n << 52n) : fraction) * sign,
    power: exponent ? exponent - 1023 - 52 : -1074 };
}
function add(a: Dyadic, b: Dyadic): Dyadic {
  const power = Math.min(a.power, b.power);
  return { n: (a.n << BigInt(a.power - power)) + (b.n << BigInt(b.power - power)), power };
}
function multiply(a: Dyadic, b: Dyadic): Dyadic { return { n: a.n * b.n, power: a.power + b.power }; }
function toNumber(value: Dyadic): number {
  if (value.n === 0n) return 0;
  const sign = value.n < 0n ? -1 : 1;
  let n = value.n < 0n ? -value.n : value.n;
  // Round once, ties to even, including the binary64 subnormal grid.
  const shift = Math.max(0, n.toString(2).length - 53, -1074 - value.power);
  if (shift > 0) {
    const bits = BigInt(shift), rest = n - ((n >> bits) << bits), half = 1n << (bits - 1n);
    n >>= bits;
    if (rest > half || rest === half && (n & 1n) !== 0n) n += 1n;
  }
  const result = sign * Number(n) * 2 ** (value.power + shift);
  if (!Number.isFinite(result) || result === 0) throw new Error("exact nonzero residual exceeds binary64 precision");
  return result;
}
export function exactBinary64LineResidual(line: { a: number; b: number; c: number }, point: { x: number; y: number }): number {
  return toNumber(add(add(multiply(exactBinary64(line.a), exactBinary64(point.x)),
    multiply(exactBinary64(line.b), exactBinary64(point.y))), exactBinary64(line.c)));
}
