/** Data-only snapshot. No getter/toJSON, normalization or default injection. */
export function copyNeutralComparisonData(value: unknown): unknown {
  const ancestors = new Set<object>();
  let visits = 0;
  function copy(current: unknown, depth: number): unknown {
    if (++visits > 30000 || depth > 48) throw new Error("unsupported_input_size");
    if (current === null || current === undefined || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new Error("nonfinite_input");
      return current;
    }
    if (typeof current !== "object") throw new Error("unsupported_input_value");
    const proto = Object.getPrototypeOf(current);
    if (Object.getOwnPropertySymbols(current).length || (Array.isArray(current) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)) throw new Error("unsupported_input_prototype");
    if (ancestors.has(current)) throw new Error("cyclic_input");
    ancestors.add(current);
    const fields = Object.getOwnPropertyDescriptors(current);
    for (const [key, descriptor] of Object.entries(fields)) {
      if (!("value" in descriptor) || (!descriptor.enumerable && !(Array.isArray(current) && key === "length"))) throw new Error("unsupported_input_descriptor");
    }
    let result: unknown;
    if (Array.isArray(current)) {
      const length = fields.length!.value as number;
      if (!Number.isSafeInteger(length) || length > 30000 || Object.keys(fields).some(key => key !== "length" && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length))) throw new Error("unsupported_input_array");
      const output: unknown[] = [];
      for (let i = 0; i < length; i++) {
        if (!Object.hasOwn(fields, String(i))) throw new Error("sparse_input_array");
        output.push(copy(fields[String(i)]!.value, depth + 1));
      }
      result = output;
    } else {
      const output: Record<string, unknown> = Object.create(null);
      for (const [key, descriptor] of Object.entries(fields)) output[key] = copy(descriptor.value, depth + 1);
      result = output;
    }
    ancestors.delete(current);
    return result;
  }
  return copy(value, 0);
}
