/**
 * Ground-state electron configurations by the aufbau rule with the textbook
 * exceptions, ions by removing from the outermost shell first, and the
 * derived facts a JEE stem asks for: unpaired electrons, spin-only magnetic
 * moment, the box diagram of the valence subshells.
 */
import { elementByZ, elementBySymbol, type ElementRecord } from "./elements";
import { removeCationElectrons } from "./foundation/cationRemoval";

export interface Subshell {
  readonly n: number;
  readonly l: "s" | "p" | "d" | "f";
  readonly electrons: number;
}

export interface ElectronConfiguration {
  readonly element: ElementRecord;
  readonly charge: number;
  readonly electrons: number;
  /** Subshells in n-then-l order with their occupancy (only occupied ones). */
  readonly subshells: readonly Subshell[];
  /** Full spelled-out form: 1s2 2s2 2p6 ... */
  readonly full: string;
  /** Noble-gas core form: [Ar] 3d5 4s1 */
  readonly condensed: string;
  readonly unpairedElectrons: number;
  /** Spin-only magnetic moment, Bohr magnetons. */
  readonly magneticMomentBM: number;
  /** Orbital boxes of the outermost subshells, each box's electron count (0, 1 or 2). */
  readonly valenceBoxes: ReadonlyArray<{ subshell: Subshell; boxes: readonly number[] }>;
}

const L_ORDER: Record<Subshell["l"], number> = { s: 0, p: 1, d: 2, f: 3 };
const CAPACITY: Record<Subshell["l"], number> = { s: 2, p: 6, d: 10, f: 14 };

/** Madelung order the aufbau fills in. */
const AUFBAU: ReadonlyArray<[number, Subshell["l"]]> = [
  [1, "s"], [2, "s"], [2, "p"], [3, "s"], [3, "p"], [4, "s"], [3, "d"], [4, "p"], [5, "s"], [4, "d"],
  [5, "p"], [6, "s"], [4, "f"], [5, "d"], [6, "p"], [7, "s"], [5, "f"], [6, "d"], [7, "p"],
];

/** Textbook ground-state exceptions, written as the subshells that differ from aufbau. */
const EXCEPTIONS: Record<string, string> = {
  Cr: "3d5 4s1", Cu: "3d10 4s1", Nb: "4d4 5s1", Mo: "4d5 5s1", Ru: "4d7 5s1", Rh: "4d8 5s1",
  Pd: "4d10 5s0", Ag: "4d10 5s1", Pt: "5d9 6s1", Au: "5d10 6s1",
  La: "4f0 5d1 6s2", Ce: "4f1 5d1 6s2", Gd: "4f7 5d1 6s2", Lu: "4f14 5d1 6s2",
  Ac: "5f0 6d1 7s2", Th: "5f0 6d2 7s2", Pa: "5f2 6d1 7s2", U: "5f3 6d1 7s2", Np: "5f4 6d1 7s2",
  Cm: "5f7 6d1 7s2", Lr: "5f14 6d1 7s2",
};

const NOBLE_GASES = [2, 10, 18, 36, 54, 86];

/**
 * Ionization can rearrange valence orbitals; removal from the neutral atom is
 * not a ground-state oracle for these two measured/studied atomic ions.
 * Ce II: NIST Handbook, 4f(2F)5d2(3F), energy 0 cm^-1:
 * https://physics.nist.gov/PhysRefData/Handbook/Tables/ceriumtable6.htm
 * Th IV: Flambaum/Porsev, Phys. Rev. A 80, 064502 (2009), 5f5/2 ground level:
 * https://arxiv.org/abs/0910.3459
 */
const ION_GROUND_STATES: ReadonlyMap<string, { coreZ: number; valence: readonly [string, number][] }> = new Map([
  ["Ce:1", { coreZ: 54, valence: [["4f", 1], ["5d", 2]] }],
  ["Th:3", { coreZ: 86, valence: [["5f", 1]] }],
]);

function subshellKey(n: number, l: Subshell["l"]): string {
  return `${n}${l}`;
}

function neutralOccupancy(z: number): Map<string, number> {
  const occupancy = new Map<string, number>();
  let remaining = z;
  for (const [n, l] of AUFBAU) {
    if (remaining <= 0) break;
    const take = Math.min(CAPACITY[l], remaining);
    occupancy.set(subshellKey(n, l), take);
    remaining -= take;
  }
  const element = elementByZ(z);
  const exception = element ? EXCEPTIONS[element.symbol] : undefined;
  if (exception) {
    for (const token of exception.split(" ")) {
      const match = /^(\d)([spdf])(\d+)$/.exec(token);
      if (!match) continue;
      const key = subshellKey(Number(match[1]), match[2] as Subshell["l"]);
      const count = Number(match[3]);
      if (count === 0) occupancy.delete(key);
      else occupancy.set(key, count);
    }
  }
  return occupancy;
}

function sortedSubshells(occupancy: Map<string, number>): Subshell[] {
  return [...occupancy.entries()]
    .filter(([, electrons]) => electrons > 0)
    .map(([key, electrons]) => ({ n: Number(key[0]), l: key[1] as Subshell["l"], electrons }))
    .sort((a, b) => a.n - b.n || L_ORDER[a.l] - L_ORDER[b.l]);
}

/**
 * Remove electrons for a cation from the highest n first (4s before 3d,
 * 6p before 6s for Pb2+), add electrons for an anion by the aufbau order.
 */
function applyCharge(occupancy: Map<string, number>, charge: number, atomicNumber: number): void {
  if (charge > 0) {
    const coreZ = [...NOBLE_GASES].reverse().find((z) => z < atomicNumber);
    const closedCore = coreZ === undefined ? new Map<string, number>() : neutralOccupancy(coreZ);
    removeCationElectrons(occupancy, charge, closedCore);
  } else if (charge < 0) {
    let toAdd = -charge;
    for (const [n, l] of AUFBAU) {
      if (toAdd <= 0) break;
      const key = subshellKey(n, l);
      const current = occupancy.get(key) ?? 0;
      const room = CAPACITY[l] - current;
      if (room <= 0) continue;
      const put = Math.min(room, toAdd);
      occupancy.set(key, current + put);
      toAdd -= put;
    }
  }
}

function unpairedIn(subshell: Subshell): number {
  const orbitals = CAPACITY[subshell.l] / 2;
  return subshell.electrons <= orbitals ? subshell.electrons : 2 * orbitals - subshell.electrons;
}

function boxesFor(subshell: Subshell): number[] {
  const orbitals = CAPACITY[subshell.l] / 2;
  const boxes = new Array<number>(orbitals).fill(0);
  for (let e = 0; e < subshell.electrons; e += 1) boxes[e % orbitals]! += 1;
  return boxes;
}

export function electronConfiguration(elementOrSymbol: ElementRecord | string, charge = 0): ElectronConfiguration | null {
  const element = typeof elementOrSymbol === "string" ? elementBySymbol(elementOrSymbol) : elementOrSymbol;
  if (!element || !Number.isInteger(charge)) return null;
  const electrons = element.z - charge;
  if (electrons < 0 || electrons > 118) return null;
  const reference = ION_GROUND_STATES.get(`${element.symbol}:${charge}`);
  const occupancy = neutralOccupancy(reference?.coreZ ?? element.z);
  if (reference) {
    for (const [key, count] of reference.valence) occupancy.set(key, count);
  } else applyCharge(occupancy, charge, element.z);
  const subshells = sortedSubshells(occupancy);
  const full = subshells.map((shell) => `${shell.n}${shell.l}${shell.electrons}`).join(" ");
  // A count alone cannot establish a closed core after ionization leaves holes.
  const core = [...NOBLE_GASES].reverse().find((z) => z <= electrons
    && [...neutralOccupancy(z)].every(([key, count]) => (occupancy.get(key) ?? 0) >= count));
  let condensed = full;
  if (core !== undefined) {
    const coreShells = sortedSubshells(neutralOccupancy(core));
    const coreKeys = new Map(coreShells.map((shell) => [subshellKey(shell.n, shell.l), shell.electrons]));
    const rest = subshells
      .map((shell) => {
        const inCore = coreKeys.get(subshellKey(shell.n, shell.l)) ?? 0;
        return shell.electrons > inCore ? { ...shell, electrons: shell.electrons - inCore } : null;
      })
      .filter((shell): shell is Subshell => shell !== null);
    const coreSymbol = elementByZ(core)!.symbol;
    condensed = `[${coreSymbol}]${rest.length ? " " + rest.map((shell) => `${shell.n}${shell.l}${shell.electrons}`).join(" ") : ""}`;
  }
  const unpairedElectrons = subshells.reduce((sum, shell) => sum + unpairedIn(shell), 0);
  const magneticMomentBM = Math.sqrt(unpairedElectrons * (unpairedElectrons + 2));
  const valence = valenceSubshells(subshells);
  return {
    element,
    charge,
    electrons,
    subshells,
    full,
    condensed,
    unpairedElectrons,
    magneticMomentBM: Number(magneticMomentBM.toFixed(2)),
    valenceBoxes: valence.map((subshell) => ({ subshell, boxes: boxesFor(subshell) })),
  };
}

/**
 * The subshells a box diagram shows: everything past the last noble-gas core,
 * so Fe reads 3d6 4s2 and Cl- reads 3s2 3p6.
 */
function valenceSubshells(subshells: readonly Subshell[]): Subshell[] {
  const total = subshells.reduce((sum, shell) => sum + shell.electrons, 0);
  const core = [...NOBLE_GASES].reverse().find((z) => z < total);
  if (core === undefined) return [...subshells];
  const coreShells = new Map(sortedSubshells(neutralOccupancy(core)).map((shell) => [subshellKey(shell.n, shell.l), shell.electrons]));
  return subshells
    .map((shell) => {
      const inCore = coreShells.get(subshellKey(shell.n, shell.l)) ?? 0;
      return shell.electrons > inCore ? { ...shell, electrons: shell.electrons - inCore } : null;
    })
    .filter((shell): shell is Subshell => shell !== null);
}

/** d-electron count of a transition-metal ion, the CFT starting point. */
export function dElectronCount(metal: ElementRecord, oxidationState: number): number | null {
  const configuration = electronConfiguration(metal, oxidationState);
  if (!configuration) return null;
  const d = configuration.subshells.filter((shell) => shell.l === "d");
  if (d.length === 0) return 0;
  const outerD = d[d.length - 1]!;
  return outerD.electrons;
}
