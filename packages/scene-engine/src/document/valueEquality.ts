/** JSON scene values retain array order, but object key order is not authority. */
export function sameSceneValue(left: unknown, right: unknown): boolean {
  const orderedObject = (_key: string, value: unknown): unknown => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  };
  return JSON.stringify(left, orderedObject) === JSON.stringify(right, orderedObject);
}
