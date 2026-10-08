/**
 * Atomic and ionic size, and first versus successive ionisation enthalpy
 * (JEE periodicity). Family chem_periodic.
 *
 * radiusPm on the element table is the Cordero covalent radius of the
 * neutral atom. ie1 is the first ionisation enthalpy. Neither is reused
 * for a different quantity: covalent radii are not plotted as ionic radii,
 * and ie1 is not plotted as a second or later ionisation enthalpy.
 *
 * Ionic radii are the six-coordinate values already stored in the
 * IONIC_RADIUS map in periodicTrend.ts. That map is not exported, so only
 * the ions this figure needs are repeated here:
 * Na+ 102, Mg2+ 72, Al3+ 54, F- 133, O2- 140, N3- 171 pm.
 * No other ionic radius is invented.
 *
 * Period-2 and period-3 first-IE curves, the group-1 covalent-radius
 * curve, the Na/Mg/Al/Si first-IE order, and the Na+/Mg2+/F-/O2- ionic
 * order stay on periodicTrend.ts.
 */
import type { SceneDocument } from "../types";
import { elementByName, elementBySymbol, type ElementRecord } from "./elements";
import { normalizeChemistryText } from "./formula";
import { ChemScene, chemStem, type ChemPlanQuantity } from "./sceneKit";

const FAMILY = "chem_periodic" as const;
const MAX_LABELS = 6;

/**
 * Six-coordinate ionic radii, pm. Same values as IONIC_RADIUS in
 * periodicTrend.ts (Shannon / NCERT, six-coordinate). Key is symbol,
 * sign, then charge magnitude, matching that map.
 */
const SIX_COORD_PM: Readonly<Record<string, number>> = {
  "Na+1": 102,
  "Mg+2": 72,
  "Al+3": 54,
  "F-1": 133,
  "O-2": 140,
  "N-3": 171,
};

const QUARTET = ["F-1", "Mg+2", "Na+1", "O-2"].sort().join(",");

interface Ion {
  readonly element: ElementRecord;
  readonly charge: number;
  readonly key: string;
  readonly short: string;
  /** Null when this ion is not in the six-coordinate list above. */
  readonly pm: number | null;
  readonly electrons: number;
}

interface KnownIon extends Ion {
  readonly pm: number;
}

interface IePoint {
  readonly rank: number;
  readonly value: number;
  readonly element: ElementRecord | null;
}

type AccountRead = { readonly status: "none" } | { readonly status: "bad" } | { readonly status: "ok"; readonly points: readonly IePoint[] };

const ION_SOURCE = String.raw`([A-Z][a-z]?)(?:\^\(\s*(\d*)\s*([+-])\s*\)|(\d+)([+-])|([+-]))`;

function stemOf(question: string): string {
  return chemStem(question).replace(/iso-electronic|iso electronic/g, "isoelectronic");
}

function ionShort(symbol: string, charge: number): string {
  const magnitude = Math.abs(charge);
  const sign = charge > 0 ? "+" : "-";
  return magnitude === 1 ? `${symbol}${sign}` : `${symbol}${magnitude}${sign}`;
}

function readIons(question: string): Ion[] {
  const text = normalizeChemistryText(question);
  const ions: Ion[] = [];
  for (const match of text.matchAll(new RegExp(ION_SOURCE, "g"))) {
    const symbol = match[1];
    const sign = match[3] ?? match[5] ?? match[6];
    if (!symbol || (sign !== "+" && sign !== "-")) continue;
    const element = elementBySymbol(symbol);
    if (!element) continue;
    const digits = match[2] ?? match[4] ?? "";
    const magnitude = digits === "" ? 1 : Number(digits);
    if (!Number.isInteger(magnitude) || magnitude < 1 || magnitude > 8) continue;
    const charge = sign === "+" ? magnitude : -magnitude;
    const key = `${symbol}${sign}${magnitude}`;
    if (ions.some((ion) => ion.key === key)) continue;
    ions.push({
      element,
      charge,
      key,
      short: ionShort(symbol, charge),
      pm: SIX_COORD_PM[key] ?? null,
      electrons: element.z - charge,
    });
  }
  return ions;
}

function neutralMentions(question: string): ElementRecord[] {
  const text = normalizeChemistryText(question).replace(new RegExp(ION_SOURCE, "g"), " ");
  const found: ElementRecord[] = [];
  const add = (element: ElementRecord | null): void => {
    if (!element || found.includes(element)) return;
    found.push(element);
  };
  for (const match of text.matchAll(/\b([A-Z][a-z]{2,})\b/g)) add(elementByName(match[1]!));
  for (const match of text.matchAll(/\b([A-Z][a-z])\b/g)) add(elementBySymbol(match[1]!));
  return found;
}

function asksSuccessive(stem: string): boolean {
  return /\b(?:second|2nd|third|3rd|fourth|4th)\s+ioni[sz]ation/.test(stem)
    || /\bsuccessive\s+ioni[sz]ation/.test(stem)
    || /\bie\s*[234]\b/.test(stem);
}

function mentionsShellJump(stem: string): boolean {
  return /shell jump|new shell|inner shell|next shell|another shell|shell change|change of shell|different shell/.test(stem);
}

function mentionsBeB(stem: string): boolean {
  if (/beryllium/.test(stem) && /boron/.test(stem)) return true;
  return /\bbe\b/.test(stem) && /\bb\b/.test(stem);
}

function mentionsNO(stem: string): boolean {
  if (/nitrogen/.test(stem) && /oxygen/.test(stem)) return true;
  return /\bn\b/.test(stem) && /\bo\b/.test(stem);
}

/** Whole-period first-IE curves already drawn by periodicTrend.ts. */
function isWholePeriodFirstIe(stem: string): boolean {
  if (!/ioni[sz]ation/.test(stem) || asksSuccessive(stem)) return false;
  const range = /from\s+(?:li|lithium)\s+to\s+(?:ne|neon)|from\s+(?:na|sodium)\s+to\s+(?:ar|argon)/.test(stem);
  const curve = /across period|variation of first|how does the first/.test(stem);
  const namesException = (mentionsBeB(stem) || mentionsNO(stem) || /not monotonic/.test(stem)) && !range && !curve;
  if (namesException) return false;
  if (range) return true;
  const period = /second period|third period|period\s*[23]\b/.test(stem);
  const plot = /across|variation|how does|plot the|trend|vary/.test(stem);
  return period && plot;
}

/** Group-1 covalent radii already drawn by periodicTrend.ts. */
function isGroup1CovalentRadius(stem: string): boolean {
  if (/ionic/.test(stem)) return false;
  if (!/atomic (?:radi|size)|covalent radi|\bradii\b|\bradius\b/.test(stem)) return false;
  if (/group\s*1\b|alkali metals?/.test(stem)) return true;
  const alkali = [/\bli\b|lithium/, /\bna\b|sodium/, /\bk\b|potassium/, /\brb\b|rubidium/, /\bcs\b|caesium|cesium/];
  return alkali.filter((pattern) => pattern.test(stem)).length >= 4;
}

/** The Na, Mg, Al, Si first-IE order already drawn by periodicTrend.ts. */
function isNaMgAlSiFirstIe(stem: string): boolean {
  if (!/ioni[sz]ation/.test(stem) || asksSuccessive(stem)) return false;
  return [/\bna\b|sodium/, /\bmg\b|magnesium/, /\bal\b|aluminium|aluminum/, /\bsi\b|silicon/].every((pattern) => pattern.test(stem));
}

/** Na+, Mg2+, F-, O2- without the other two six-coordinate ions. */
function isIonicQuartet(question: string): boolean {
  const ions = readIons(question);
  if (ions.length !== 4) return false;
  return ions.map((ion) => ion.key).sort().join(",") === QUARTET;
}

function heldByPeriodicTrend(question: string, stem: string): boolean {
  return isWholePeriodFirstIe(stem) || isGroup1CovalentRadius(stem) || isNaMgAlSiFirstIe(stem) || isIonicQuartet(question);
}

function claimsFirstIeException(stem: string): boolean {
  if (!/ioni[sz]ation/.test(stem) || asksSuccessive(stem) || isWholePeriodFirstIe(stem)) return false;
  if (/period\s*3\b|third period/.test(stem) && !mentionsBeB(stem) && !mentionsNO(stem)) return false;
  return mentionsBeB(stem) || mentionsNO(stem) || /not monotonic/.test(stem);
}

function claimsRadiusTopic(question: string, stem: string): boolean {
  const aboutIonic = /ionic radi|ionic size/.test(stem)
    || (/isoelectronic/.test(stem) && /radi|size|nuclear charge|6-coord|six[- ]coord/.test(stem));
  const definition = /covalent radi/.test(stem) && /ionic radi/.test(stem);
  const vdw = /van der waals|vanderwaals/.test(stem);
  const qualitative = /cation/.test(stem) && /anion/.test(stem) && /radi|size/.test(stem);
  const misuse = /fill|estimat|guess|unknown/.test(stem) && /radi/.test(stem);
  if (!aboutIonic && !definition && !vdw && !qualitative && !misuse) return false;
  const ions = readIons(question);
  if (ions.length === 0) return true;
  const unknown = ions.filter((ion) => ion.pm === null);
  const known = ions.filter((ion) => ion.pm !== null);
  if (unknown.length === 0) return known.length >= 1;
  if (known.length > 0) return true;
  return /fill|estimat|guess|unknown|covalent|as ionic/.test(stem);
}

/** True when this module owns the stem, including stems it must decline. */
export function claimsPeriodicSize(question: string): boolean {
  const stem = stemOf(question);
  if (!stem.trim() || heldByPeriodicTrend(question, stem)) return false;
  if (/bond length|bond order|electronegativ|electron gain|electron affinit|oxidation state|metallic character/.test(stem)
    && !/ionic radi|covalent radi|ioni[sz]ation/.test(stem)) return false;
  return asksSuccessive(stem) || mentionsShellJump(stem) || claimsFirstIeException(stem) || claimsRadiusTopic(question, stem);
}

function place(question: string, reason: string, labels: readonly string[], caption: string): SceneDocument | null {
  if (labels.length === 0 || labels.length > MAX_LABELS) return null;
  if (labels.some((label) => label.length === 0 || label.length > 16)) return null;
  const scene = new ChemScene(question, reason, FAMILY);
  const ids: string[] = [];
  let y = 2.6;
  for (const [index, label] of labels.entries()) {
    ids.push(scene.text(`v${index}`, { x: 0.2, y }, label, "stated result"));
    y -= 0.8;
  }
  scene.scene.group("result", ids, `${reason}. ${labels.join(", ")}.`);
  return scene.build({ caption });
}

function chainLines(parts: readonly string[], separator: string): string[] | null {
  const lines: string[] = [];
  let current = "";
  for (const part of parts) {
    const next = current === "" ? part : `${current}${separator}${part}`;
    if (next.length <= 16) {
      current = next;
      continue;
    }
    if (current === "" || part.length > 16) return null;
    lines.push(current);
    current = part;
  }
  if (current) lines.push(current);
  return lines;
}

function zLabel(symbols: readonly string[]): string {
  const body = symbols.join("<");
  if (`Z ${body}`.length <= 16) return `Z ${body}`;
  if (body.length <= 16) return body;
  return "Z rises";
}

function seriesLabels(ions: readonly KnownIon[]): string[] | null {
  if (ions.length === 0) return null;
  const ordered = [...ions].sort((a, b) => a.element.z - b.element.z || a.charge - b.charge);
  const electrons = ordered[0]!.electrons;
  if (!ordered.every((ion) => ion.electrons === electrons)) return null;
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.pm >= ordered[index - 1]!.pm) return null;
  }
  const countLabel = `${electrons} electrons`;
  const radii = chainLines(ordered.map((ion) => String(ion.pm)), ">");
  if (!radii) return null;
  const last = radii.length - 1;
  const withUnit = `${radii[last]} pm`;
  if (withUnit.length > 16) return null;
  radii[last] = withUnit;
  const labels = [countLabel, "6-coord", zLabel(ordered.map((ion) => ion.element.symbol)), ...radii];
  if (ordered.length >= 2) labels.push("r falls, Z rises");
  const species = ordered.map((ion) => ion.short).join(" ");
  if (species.length <= 16 && labels.length < MAX_LABELS) labels.push(species);
  if (labels.length > MAX_LABELS || labels.some((label) => label.length === 0 || label.length > 16)) return null;
  if (!ordered.every((ion) => labels.some((label) => label.includes(String(ion.pm))))) return null;
  return labels;
}

function seriesCaption(ions: readonly KnownIon[]): string {
  const ordered = [...ions].sort((a, b) => a.element.z - b.element.z);
  const detail = ordered.map((ion) => `${ion.short}: Z=${ion.element.z}, charge ${ion.charge}, ${ion.electrons} electrons, ${ion.pm} pm`).join("; ");
  return `Six-coordinate ionic radii (6-coord). ${detail}. These ions are isoelectronic, so the radius falls as nuclear charge rises. Cordero covalent radii are not used.`;
}

function asksMixedPlot(stem: string): boolean {
  if (/(?:do not|don't|never|avoid)\b[^.]{0,40}(?:same axis|one axis|mixed|plot)/.test(stem)) return false;
  if (!/covalent|atomic radi|neutral/.test(stem) || !/ionic/.test(stem)) return false;
  if (/defin|distinguish|mean|differen/.test(stem) && !/same axis|one axis|plot/.test(stem)) return false;
  return /plot|compare|graph|same axis|one axis|order/.test(stem);
}

function buildRadius(question: string, stem: string): SceneDocument | null {
  if (/van der waals|vanderwaals/.test(stem)) return null;
  if (asksMixedPlot(stem)) return null;
  const ions = readIons(question);
  if (ions.some((ion) => ion.pm === null)) return null;
  const known = ions as KnownIon[];
  if (known.length >= 1) {
    const labels = seriesLabels(known);
    if (!labels) return null;
    return place(question, "six-coordinate isoelectronic ionic radii", labels, seriesCaption(known));
  }
  if (/cation/.test(stem) && /anion/.test(stem)) {
    return place(
      question,
      "cation and anion size without mixing radius conventions",
      ["cation smaller", "anion larger", "same Z", "no mixed r"],
      "A cation is smaller than its parent atom: the nuclear charge is unchanged and there are fewer electrons. An anion is larger: the nuclear charge is unchanged and there are more electrons. Covalent radii and ionic radii are not placed on one axis.",
    );
  }
  const neutrals = neutralMentions(question);
  const symbols = neutrals.map((element) => element.symbol).join(" ");
  const labels = ["cov != ionic", "need charge", "no ion plot"];
  if (symbols.length > 0 && symbols.length <= 16) labels.push(symbols);
  return place(
    question,
    "covalent radius is not an ionic radius",
    labels,
    "Ionic radius is the radius of an ion under a stated coordination convention. The neutral-atom radii in the element table are Cordero covalent radii. They are not ionic radii and are not plotted here.",
  );
}

function buildException(question: string): SceneDocument | null {
  const be = elementBySymbol("Be");
  const boron = elementBySymbol("B");
  const nitrogen = elementBySymbol("N");
  const oxygen = elementBySymbol("O");
  if (!be || !boron || !nitrogen || !oxygen) return null;
  if (!(be.ie1 > boron.ie1 && nitrogen.ie1 > oxygen.ie1)) return null;
  const beB = `${be.ie1}>${boron.ie1} kJ/mol`;
  const nO = `${nitrogen.ie1}>${oxygen.ie1} kJ/mol`;
  if (beB.length > 16 || nO.length > 16) return null;
  return place(
    question,
    "first ionisation enthalpy exceptions",
    ["Be>B", beB, "N>O", nO, "not monotonic"],
    `First ionisation enthalpies from the element table, in kJ/mol: Be ${be.ie1} > B ${boron.ie1}, and N ${nitrogen.ie1} > O ${oxygen.ie1}. The order is not monotonic in atomic number. A smooth increase is not drawn.`,
  );
}

function resolveLoose(token: string): ElementRecord | null {
  const named = elementByName(token);
  if (named) return named;
  if (!/^[a-z]{1,2}$/i.test(token)) return null;
  const symbol = token.length === 1
    ? token.toUpperCase()
    : `${token[0]!.toUpperCase()}${token.slice(1).toLowerCase()}`;
  return elementBySymbol(symbol);
}

function integerText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
}

function remember(points: IePoint[], seen: Map<string, number>, point: IePoint): boolean {
  const key = `${point.element?.symbol ?? "*"}:${point.rank}`;
  const previous = seen.get(key);
  if (previous !== undefined && previous !== point.value) return false;
  if (previous === undefined) {
    seen.set(key, point.value);
    points.push(point);
  }
  return true;
}

function contradictsTable(point: IePoint): boolean {
  if (!point.element) return false;
  if (point.rank === 1) return point.value !== point.element.ie1;
  return point.value === point.element.ie1;
}

/** Successive enthalpies written in the stem. A contradiction with ie1 is rejected. */
function readAccounts(stem: string): AccountRead {
  const points: IePoint[] = [];
  const seen = new Map<string, number>();
  const rankWord: Readonly<Record<string, number>> = { second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4 };
  const lists = stem.matchAll(/successive ioni[sz]ation(?:\s+(?:enthalp\w*|energ\w*|potential))?(?:\s+of\s+(?:the\s+)?([a-z]{1,14}))?\s*(?:=|are|:)\s*(\d+(?:\.\d+)?(?:\s*(?:,|and)\s*\d+(?:\.\d+)?){1,7})/g);
  for (const match of lists) {
    const element = match[1] ? resolveLoose(match[1]) : null;
    const values = match[2]!.split(/\s*(?:,|and)\s*/).map(Number);
    for (const [index, value] of values.entries()) {
      if (!Number.isFinite(value)) return { status: "bad" };
      const point = { rank: index + 1, value, element };
      if (contradictsTable(point) || !remember(points, seen, point)) return { status: "bad" };
    }
  }
  const ranks = stem.matchAll(/\b(second|third|fourth|2nd|3rd|4th)\s+ioni[sz]ation(?:\s+(?:enthalp\w*|energ\w*|potential))?(?:\s+of\s+(?:the\s+)?([a-z]{1,14}))?\s*(?:=|is|equals)\s*(\d+(?:\.\d+)?)/g);
  for (const match of ranks) {
    const rank = rankWord[match[1]!];
    const element = match[2] ? resolveLoose(match[2]) : null;
    const value = Number(match[3]);
    if (!rank || !Number.isFinite(value)) return { status: "bad" };
    const point = { rank, value, element };
    if (contradictsTable(point) || !remember(points, seen, point)) return { status: "bad" };
  }
  const indexed = stem.matchAll(/\bie\s*([1-4])\b(?:\s+of\s+(?:the\s+)?([a-z]{1,14}))?\s*(?:=|is|equals)\s*(\d+(?:\.\d+)?)/g);
  for (const match of indexed) {
    const element = match[2] ? resolveLoose(match[2]) : null;
    const value = Number(match[3]);
    if (!Number.isFinite(value)) return { status: "bad" };
    const point = { rank: Number(match[1]), value, element };
    if (contradictsTable(point) || !remember(points, seen, point)) return { status: "bad" };
  }
  return points.length === 0 ? { status: "none" } : { status: "ok", points };
}

function pointLabel(point: IePoint): string | null {
  const core = `IE${point.rank}=${integerText(point.value)}`;
  const withSymbol = point.element ? `${point.element.symbol} ${core}` : core;
  if (withSymbol.length <= 16) return withSymbol;
  return core.length <= 16 ? core : null;
}

function buildSuccessive(question: string, stem: string): SceneDocument | null {
  const read = readAccounts(stem);
  if (read.status !== "ok") return null;
  const higher = read.points.filter((point) => point.rank >= 2);
  if (higher.length === 0) return null;
  const labels: string[] = [];
  for (const point of [...read.points].sort((a, b) => a.rank - b.rank || (a.element?.z ?? 0) - (b.element?.z ?? 0))) {
    const label = pointLabel(point);
    if (!label) return null;
    labels.push(label);
  }
  labels.push(mentionsShellJump(stem) ? "not from IE1" : "not IE1");
  labels.push("from stem");
  if (mentionsShellJump(stem)) labels.push("jump stated");
  const caption = mentionsShellJump(stem)
    ? "The later ionisation enthalpies are the numbers supplied in the stem. A shell jump is marked only because those later values are given. It is not inferred from the first ionisation enthalpy."
    : "The successive ionisation enthalpy is the number supplied in the stem. The first ionisation enthalpy from the element table is not substituted for it.";
  return place(question, "successive ionisation enthalpy from the stem", labels, caption);
}

/**
 * The size or ionisation figure, or null when the stem is not ours or
 * cannot be drawn without inventing a radius, mixing conventions, or
 * treating the first ionisation enthalpy as a later one.
 * Planner quantities are ignored: a missing ionic radius is not filled in.
 */
export function buildPeriodicSizeScene(
  question: string,
  quantities: ChemPlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  void quantities;
  void schematic;
  if (!claimsPeriodicSize(question)) return null;
  const stem = stemOf(question);
  try {
    if (asksSuccessive(stem) || mentionsShellJump(stem)) return buildSuccessive(question, stem);
    if (claimsFirstIeException(stem)) return buildException(question);
    if (claimsRadiusTopic(question, stem)) return buildRadius(question, stem);
    return null;
  } catch {
    return null;
  }
}
