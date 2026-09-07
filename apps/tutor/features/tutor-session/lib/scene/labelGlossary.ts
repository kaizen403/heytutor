import type { VerifiedLabelFact } from "@heytutor/drawing";
import type { SceneDocument } from "@heytutor/scene-engine";

/**
 * What a diagram label means, so a student can ask the board.
 *
 * A figure is labelled in symbols — `R_1`, `a`, `θ` — because a full phrase
 * would bury the geometry. The expansion and the solved value still exist in
 * the scene document, so the board can hand them back on demand instead of
 * making the student hold the mapping in their head.
 *
 * Everything here is derived from the verified document: the glossary can only
 * repeat quantities the solver already established, never invent one.
 */

/** The transport type is the source of truth; this is the local alias. */
export type LabelFact = VerifiedLabelFact;

export type LabelGlossary = Record<string, LabelFact>;

/** Strip subscript/superscript syntax so `R_1` and `R1` compare equal. */
export function normalizeSymbol(raw: string): string {
  return raw
    .trim()
    .replace(/[{}]/g, "")
    .replace(/[_^]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

const ROLE_WORDS: Record<string, string> = {
  resistor: "Resistor",
  capacitor: "Capacitor",
  inductor: "Inductor",
  battery: "Battery",
  cell: "Cell",
  lens: "Lens",
  mirror: "Mirror",
  object: "Object",
  image: "Image",
  ray: "Ray",
  normal: "Normal",
  vertex: "Vertex",
  point: "Point",
  angle: "Angle",
  force: "Force",
  velocity: "Velocity",
  acceleration: "Acceleration",
  mass: "Mass",
  block: "Block",
  pulley: "Pulley",
  spring: "Spring",
  surface: "Surface",
  axis: "Axis",
  origin: "Origin",
  centre: "Centre",
  center: "Centre",
  radius: "Radius",
  focus: "Focus",
};

function humaniseRole(role: string | undefined): string | null {
  if (!role) return null;
  const key = role.trim().toLowerCase().replace(/[\s_-]+/g, "_");
  if (ROLE_WORDS[key]) return ROLE_WORDS[key];
  // Fall back to title-casing whatever the engine called it.
  const words = key.split("_").filter(Boolean);
  if (words.length === 0) return null;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** `R_1` → index 1, so a role can be numbered the way the figure numbers it. */
function symbolIndex(symbol: string): string | null {
  const match = symbol.match(/(\d+)\s*$/);
  return match ? match[1]! : null;
}

/**
 * "Resistor 1" from role `resistor` and symbol `R_1`. An explicit entity label
 * always wins — the engine knows better than this heuristic.
 */
export function expandSymbol(symbol: string, role: string | undefined, label: string | undefined): string {
  const explicit = label?.trim();
  if (explicit && normalizeSymbol(explicit) !== normalizeSymbol(symbol)) {
    return explicit;
  }
  const roleWord = humaniseRole(role);
  if (!roleWord) return symbol;
  const index = symbolIndex(symbol);
  return index ? `${roleWord} ${index}` : roleWord;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatValue(quantity: Record<string, unknown>): string | undefined {
  const raw = quantity.value;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  // Keep the solver's precision without printing floating-point noise.
  const rounded = Math.abs(raw) >= 1000 || Number.isInteger(raw)
    ? String(raw)
    : String(Number(raw.toPrecision(4)));
  const unit = typeof quantity.unit === "string" ? quantity.unit.trim() : "";
  return unit ? `${rounded} ${unit}` : rounded;
}

function provenanceOf(quantity: Record<string, unknown>): LabelFact["provenance"] {
  const raw = quantity.provenance;
  return raw === "given" || raw === "derived" || raw === "assumed" ? raw : undefined;
}

/**
 * Build the lookup the board consults when a label is hovered. Keyed by the
 * normalized label text, because that is what the board actually drew.
 */
export function buildLabelGlossary(document: SceneDocument): LabelGlossary {
  const glossary: LabelGlossary = {};

  const quantitiesBySymbol = new Map<string, Record<string, unknown>>();
  for (const quantity of document.quantities ?? []) {
    if (!isRecord(quantity)) continue;
    const symbol = typeof quantity.symbol === "string" ? quantity.symbol : quantity.id;
    if (typeof symbol !== "string" || symbol.length === 0) continue;
    const key = normalizeSymbol(symbol);
    // First writer wins: givens are listed before derived restatements.
    if (!quantitiesBySymbol.has(key)) quantitiesBySymbol.set(key, quantity);
  }

  const record = (symbol: string, role: string | undefined, label: string | undefined): void => {
    const key = normalizeSymbol(symbol);
    if (key.length === 0 || glossary[key]) return;
    const quantity = quantitiesBySymbol.get(key);
    const fact: LabelFact = {
      symbol: symbol.trim(),
      title: expandSymbol(symbol, role, label),
    };
    if (quantity) {
      const value = formatValue(quantity);
      if (value) fact.value = value;
      const provenance = provenanceOf(quantity);
      if (provenance) fact.provenance = provenance;
      const source = quantity.sourceText;
      if (typeof source === "string" && source.trim().length > 0) {
        fact.detail = source.trim();
      }
    }
    // A label with nothing to add is not worth making interactive.
    if (fact.value || fact.detail || fact.title !== fact.symbol) {
      glossary[key] = fact;
    }
  };

  for (const entity of document.entities ?? []) {
    const label = typeof entity.label === "string" ? entity.label : undefined;
    if (label) record(label, entity.role, label);
    record(entity.id, entity.role, label);
  }

  // Quantities that never became an entity still deserve an expansion.
  for (const [key, quantity] of quantitiesBySymbol) {
    if (glossary[key]) continue;
    const symbol = typeof quantity.symbol === "string" ? quantity.symbol : String(quantity.id);
    const value = formatValue(quantity);
    if (!value) continue;
    const fact: LabelFact = { symbol: symbol.trim(), title: symbol.trim(), value };
    const provenance = provenanceOf(quantity);
    if (provenance) fact.provenance = provenance;
    const source = quantity.sourceText;
    if (typeof source === "string" && source.trim().length > 0) fact.detail = source.trim();
    glossary[key] = fact;
  }

  return glossary;
}

/** Look a drawn label up. Returns null when the board has nothing to add. */
export function lookupLabel(glossary: LabelGlossary, text: string | undefined): LabelFact | null {
  if (!text) return null;
  return glossary[normalizeSymbol(text)] ?? null;
}
