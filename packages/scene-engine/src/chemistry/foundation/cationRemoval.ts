/** Remove valence electrons before opening the preceding closed noble-gas core. */
export function removeCationElectrons(
  occupancy: Map<string, number>,
  charge: number,
  closedCore: ReadonlyMap<string, number>,
): void {
  if (!Number.isInteger(charge) || charge < 0) throw new RangeError("cation charge must be a nonnegative integer");
  const angularOrder: Record<string, number> = { s: 0, p: 1, d: 2, f: 3 };
  let remaining = charge;
  while (remaining > 0) {
    const occupied = [...occupancy.entries()].filter(([, count]) => count > 0);
    // In Ln/An ions the f subshell belongs to the valence set even though
    // its n is smaller than the filled p subshell of the preceding core.
    const valence = occupied.filter(([key, count]) => count > (closedCore.get(key) ?? 0));
    const candidates = valence.length ? valence : occupied;
    candidates.sort(([a], [b]) => Number(b[0]) - Number(a[0]) || angularOrder[b[1]!]! - angularOrder[a[1]!]!);
    const victim = candidates[0];
    if (!victim) break;
    const [key, count] = victim;
    const removable = valence.length ? count - (closedCore.get(key) ?? 0) : count;
    const take = Math.min(remaining, removable);
    if (count === take) occupancy.delete(key);
    else occupancy.set(key, count - take);
    remaining -= take;
  }
}
