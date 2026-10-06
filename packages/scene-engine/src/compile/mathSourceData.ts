export class MathSourceDataError extends Error {}

export interface MathSourceResolvers {
  scalar(id: string): unknown;
  geometry?(id: string): unknown;
}

function dataSnapshot(): (value: unknown) => unknown {
  const copies = new Map<object, unknown>();
  const active = new Set<object>();
  let nodes = 0;
  let strings = 0;
  let keys = 0;
  const fail: (message: string) => never = (message) => { throw new MathSourceDataError(message); };
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > 64 || ++nodes > 16384) fail("mathematical source data exceeds depth64 or16384 nodes");
    if (typeof value === "string") {
      strings += value.length;
      if (strings > 1048576) fail("mathematical source strings exceed1048576 characters");
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail("mathematical source numbers must remain finite");
      return value;
    }
    if (value === null || value === undefined || typeof value === "boolean") return value;
    if (typeof value !== "object") fail("mathematical source values must be own data, not callable or symbolic objects");
    if (active.has(value)) fail("mathematical source data contains a cycle");
    if (copies.has(value)) return copies.get(value);
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== (array ? Array.prototype : Object.prototype)) fail("mathematical source data has a custom or inherited prototype");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Reflect.ownKeys(descriptors);
    keys += names.length;
    if (keys > 65536) fail("mathematical source data exceeds65536 own keys");
    for (const name of names) {
      if (typeof name === "string") {
        strings += name.length;
        if (strings > 1048576) fail("mathematical source keys and strings exceed1048576 characters");
        if (!Object.hasOwn(descriptors[name]!, "value")) fail("mathematical source accessors are not data and cannot be executed");
      } else fail("mathematical source data cannot contain symbol keys");
    }
    let result: unknown[] | Record<string, unknown>;
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 16384) fail("mathematical source array length is invalid or exceeds16384");
      if (names.length !== length + 1 || names.some((name) => name !== "length" && (typeof name !== "string" || !/^(?:0|[1-9]\d*)$/.test(name) || Number(name) >= length))) fail("mathematical source arrays must have every own index and no extra keys");
      result = new Array(length);
    } else result = Object.create(null) as Record<string, unknown>;
    copies.set(value, result);
    active.add(value);
    for (const name of names) {
      if (typeof name !== "string" || array && name === "length") continue;
      Object.defineProperty(result, name, { value: visit(descriptors[name]!.value, depth + 1), enumerable: true, writable: false, configurable: false });
    }
    active.delete(value);
    return Object.freeze(result);
  };
  return (value) => visit(value, 0);
}

export function snapshotMathSourceData<T>(value: T): T {
  return dataSnapshot()(value) as T;
}

export function captureMathSourceData<T>(value: T, resolvers: MathSourceResolvers): {
  data: T;
  sources: Required<MathSourceResolvers>;
} {
  const snapshot = dataSnapshot();
  const data = snapshot(value) as T;
  const scalar = resolvers.scalar;
  const geometry = resolvers.geometry;
  if (typeof scalar !== "function" || geometry !== undefined && typeof geometry !== "function") throw new MathSourceDataError("mathematical resolver methods must be trusted functions");
  const scalarValues = new Map<string, unknown>();
  const geometryValues = new Map<string, unknown>();
  return {
    data,
    sources: {
      scalar(id) {
        if (!scalarValues.has(id)) scalarValues.set(id, snapshot(scalar.call(resolvers, id)));
        return scalarValues.get(id);
      },
      geometry(id) {
        if (!geometryValues.has(id)) geometryValues.set(id, snapshot(geometry?.call(resolvers, id)));
        return geometryValues.get(id);
      },
    },
  };
}
