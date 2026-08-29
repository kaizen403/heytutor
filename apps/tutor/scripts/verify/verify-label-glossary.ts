import type { SceneDocument } from "@heytutor/scene-engine";
import {
  buildLabelGlossary,
  expandSymbol,
  lookupLabel,
  normalizeSymbol,
} from "@/features/tutor-session/lib/labelGlossary";

/**
 * The label inspector may only repeat what the verified document established.
 * These gates exist so a hover can never invent a value.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- symbol normalisation -------------------------------------------------
assert(normalizeSymbol("R_1") === normalizeSymbol("R1"), "subscript syntax must not split a symbol");
assert(normalizeSymbol("v^2") === normalizeSymbol("v2"), "superscript syntax must not split a symbol");
assert(normalizeSymbol(" F_net ") === "fnet", "whitespace and case are ignored");
assert(normalizeSymbol("R_1") !== normalizeSymbol("R_2"), "different indices stay different");

// --- expansion ------------------------------------------------------------
assert(expandSymbol("R_1", "resistor", undefined) === "Resistor 1", "role + index expands");
assert(expandSymbol("a", "acceleration", undefined) === "Acceleration", "an unnumbered role expands");
assert(expandSymbol("O", "optical_centre", undefined) === "Optical Centre", "unknown roles title-case");
assert(
  expandSymbol("R_1", "resistor", "Load resistor") === "Load resistor",
  "an explicit entity label always wins over the heuristic",
);
assert(expandSymbol("X", undefined, undefined) === "X", "with nothing to add, the symbol stands alone");

const document = {
  schemaVersion: "scene-document/v2",
  quantities: [
    { id: "q1", symbol: "R_1", value: 12, unit: "Ω", provenance: "given", sourceText: "three 12 ohm resistors" },
    { id: "q2", symbol: "R_eq", value: 36, unit: "Ω", provenance: "derived" },
    { id: "q3", symbol: "a", value: 2.4567891, unit: "m/s^2", provenance: "derived" },
    { id: "q4", symbol: "bad", value: Number.NaN, provenance: "derived" },
    { id: "q5", symbol: "big", value: 12500, unit: "N" },
  ],
  entities: [
    { id: "R_1", kind: "resistor", role: "resistor" },
    { id: "a", kind: "vector", role: "acceleration" },
    { id: "p1", kind: "point", role: "vertex", label: "P" },
    { id: "plain", kind: "line", role: "" },
  ],
  constructions: [],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: [],
  revealGroups: [],
  teachingTimeline: [],
} as unknown as SceneDocument;

const glossary = buildLabelGlossary(document);

// --- values are carried through faithfully --------------------------------
{
  const r1 = lookupLabel(glossary, "R_1");
  assert(r1, "R_1 must be answerable");
  assert(r1!.title === "Resistor 1", `expected "Resistor 1", got "${r1!.title}"`);
  assert(r1!.value === "12 Ω", `expected "12 Ω", got "${r1!.value}"`);
  assert(r1!.provenance === "given", "a given must be marked as given");
  assert(r1!.detail === "three 12 ohm resistors", "the planner's justification is carried");
}
{
  // The board draws "R1"; the document says "R_1". They must still match.
  const viaDrawnForm = lookupLabel(glossary, "R1");
  assert(viaDrawnForm?.value === "12 Ω", "the drawn form of a symbol must resolve");
}
{
  const a = lookupLabel(glossary, "a");
  assert(a?.title === "Acceleration", `expected "Acceleration", got "${a?.title}"`);
  assert(a?.value === "2.457 m/s^2", `float noise must be trimmed, got "${a?.value}"`);
  assert(a?.provenance === "derived", "a derived value must say so");
}
{
  const eq = lookupLabel(glossary, "R_eq");
  assert(eq?.value === "36 Ω", "a quantity with no entity is still answerable");
}
{
  const big = lookupLabel(glossary, "big");
  assert(big?.value === "12500 N", "large integers keep full precision");
}

// --- the glossary never invents anything ----------------------------------
assert(lookupLabel(glossary, "bad") === null, "a non-finite value must not be shown");
assert(lookupLabel(glossary, "nothing_here") === null, "an unknown symbol has no entry");
assert(lookupLabel(glossary, undefined) === null, "an unlabelled rect has no entry");
assert(lookupLabel(glossary, "") === null, "empty text has no entry");
assert(
  lookupLabel(glossary, "plain") === null,
  "an entity with no role, label or value is not worth making interactive",
);
for (const fact of Object.values(glossary)) {
  assert(fact.symbol.length > 0, "every fact keeps its symbol");
  assert(fact.title.length > 0, "every fact has something to say");
  if (fact.value !== undefined) {
    assert(!/NaN|Infinity|undefined/.test(fact.value), `bad value string: ${fact.value}`);
  }
}

// --- an empty document is safe --------------------------------------------
{
  const empty = buildLabelGlossary({} as unknown as SceneDocument);
  assert(Object.keys(empty).length === 0, "a document with nothing to say yields no entries");
  assert(lookupLabel(empty, "R_1") === null, "an empty glossary answers nothing");
}

console.log(
  `verify-label-glossary: ${Object.keys(glossary).length} symbols answerable, values carried verbatim, nothing invented`,
);
