import type { SceneConstruction, SceneDocument } from "../types";
import type { AtomicObservableDefinition } from "./atomicGeometry";

/** Resolve a regenerated physical fact to the checked output that carries it.
 * The stable label id remains based on its emitting output. Serialized label
 * provenance never supplies a different owner or result-field declaration. */
export function atomicPropertyLabelOwner(document: Pick<SceneDocument, "entities">, construction: SceneConstruction | undefined,
  model: Pick<AtomicObservableDefinition, "kind">, resultFields: readonly string[] | undefined, emitterId: string): string | undefined {
  if (!construction || construction.operator !== model.kind || !construction.outputs.includes(emitterId)) return undefined;
  const kinds = model.kind === "bohr_orbit" ? ["circle", "point", "segment", "vector"]
    : model.kind === "bohr_transition" ? ["segment", "segment", "vector"] : undefined;
  if (!kinds) return emitterId;
  if (construction.outputs[0] !== emitterId || construction.outputs.length !== kinds.length ||
      new Set(construction.outputs).size !== kinds.length || construction.outputs.some((id, index) =>
        document.entities.find(entity => entity.id === id)?.kind !== kinds[index])) return undefined;
  if (model.kind === "bohr_orbit") {
    if (resultFields?.length === 1 && resultFields[0] === "speed") return construction.outputs[3];
    // A combined speed/radius statement has no single geometry owner.
    return resultFields?.includes("speed") ? undefined : emitterId;
  }
  const fields = resultFields ?? [];
  const scopes = [["energyFrom"], ["energyTo"], ["photonEnergy", "atomicDelta", "wavelengthNm"]];
  const slot = fields.length ? scopes.findIndex(scope => fields.every(field => scope.includes(field))) : 0;
  return slot >= 0 ? construction.outputs[slot] : undefined;
}
