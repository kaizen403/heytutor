/** Generator registry: one parameterized figure per archetype. */
import type { ArchetypeId } from "../catalog";
import type { Generator, GeneratorTable } from "./context";
import { FIELD_GENERATORS } from "./fields";
import { GRAPH_GENERATORS } from "./graphs";
import { INSTRUMENT_GENERATORS } from "./instruments";
import { MATHS_GENERATORS } from "./maths";
import { MECHANICS_GENERATORS } from "./mechanics";
import { OPTICS_GENERATORS } from "./optics";
import { TOPIC_GENERATORS } from "./topics";

export type { Generator, GeneratorContext, GeneratorTable } from "./context";

const TABLE: GeneratorTable = {
  ...MECHANICS_GENERATORS,
  ...GRAPH_GENERATORS,
  ...FIELD_GENERATORS,
  ...OPTICS_GENERATORS,
  ...MATHS_GENERATORS,
  ...TOPIC_GENERATORS,
  ...INSTRUMENT_GENERATORS,
};

export function generatorFor(id: ArchetypeId): Generator | null {
  return TABLE[id] ?? null;
}

export function implementedArchetypes(): ArchetypeId[] {
  return Object.keys(TABLE) as ArchetypeId[];
}
