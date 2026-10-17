import type { DrawCommand } from "@heytutor/drawing";
import type { RenderPrimitive, SceneDocument } from "@heytutor/scene-engine";

/** Compare symbol notation, preserving case: I and i may denote different things. */
function symbolKey(value: string): string {
  return value.normalize("NFKC").replace(/[{}_\s]/g, "");
}

type Quantity = SceneDocument["quantities"][number];
function derived(quantity: Quantity): boolean {
  return quantity.provenance === "derived" || quantity.provenance === "unknown";
}
function symbolOf(quantity: Quantity): string {
  return typeof quantity.symbol === "string" ? quantity.symbol : quantity.id;
}

function componentQuantity(document: SceneDocument, entityId: string | undefined): Quantity | undefined {
  const entity = document.entities.find((candidate) => candidate.id === entityId);
  if (entity?.kind !== "component" || !entity.label || !/^[A-Za-z][A-Za-z0-9_₀-₉]{0,7}$/.test(entity.label)) return undefined;
  // Match the compiler's existing component-designator binding. This does not
  // infer a quantity from a bare displayed number or change numeric authority.
  const key = (value: string) => value.trim().toLowerCase().replace(/[₀-₉]/g, (digit) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(digit)));
  return document.quantities.find((quantity) => key(quantity.id) === key(entity.label!) || key(symbolOf(quantity)) === key(entity.label!));
}
function answerMeasurementOwners(document: SceneDocument): Set<string> {
  return new Set(document.entities.filter((entity) => entity.kind === "dimension" &&
    (isAnswerLabel(document, { text: entity.label }) || document.annotations.some((annotation) =>
      annotation.targetIds.includes(entity.id) && isAnswerLabel(document, { id: annotation.id }),
    )),
  ).map((entity) => entity.id));
}

/**
 * A timing policy, never a new numeric authority. Explicit quantity bindings
 * win; unbound text needs a complete assignment to one unambiguous verified
 * symbol. Bare names and unknown placeholders are setup, not solved values.
 */
export function isAnswerLabel(document: SceneDocument, primitive: {
  id?: string;
  text?: string;
  annotationId?: string;
  entityId?: string;
}): boolean {
  const annotation = document.annotations.find((entry) => entry.id === (primitive.annotationId ?? primitive.id));
  const text = primitive.text?.trim() || annotation?.text?.trim() || "";
  const valueText = /^\s*[^=≈:]+[=≈:]\s*(.+)$/u.exec(text)?.[1] ?? text;
  const placeholder = /^[?？…]+(.*)$/u.exec(valueText.trim());
  const unitKey = (value: string) => value.normalize("NFKC").replace(/[{}_^\s]/g, "");
  if (placeholder && (!placeholder[1]!.trim() || document.quantities.some((quantity) =>
    typeof quantity.unit === "string" && unitKey(quantity.unit) === unitKey(placeholder[1]!),
  ))) return false;
  if (annotation?.quantityId) {
    const quantity = document.quantities.find((entry) => entry.id === annotation.quantityId);
    if (!quantity || !derived(quantity)) return false;
    return ![quantity.id, symbolOf(quantity)].some((symbol) => symbolKey(symbol) === symbolKey(text));
  }
  if (primitive.entityId && primitive.id === `primitive_${primitive.entityId}_label`) {
    const entity = document.entities.find((candidate) => candidate.id === primitive.entityId);
    const quantity = componentQuantity(document, primitive.entityId);
    if (quantity && derived(quantity) && text && text !== entity?.label?.trim()) return true;
  }
  if (!text) return false;
  const assigned = /^\s*([^=≈:]{1,80})\s*[=≈:]\s*(.+)\s*$/u.exec(text);
  if (!assigned || /^[?？…\s]+$/u.test(assigned[2]!)) return false;
  const key = symbolKey(assigned[1]!);
  const quantities = document.quantities.filter((entry) =>
    symbolKey(symbolOf(entry)) === key || symbolKey(entry.id) === key,
  );
  return quantities.length === 1 && derived(quantities[0]!);
}

/** A label and its own compiled leader form one reveal; never its whole host. */
export function answerLabelPrimitiveIds(document: SceneDocument, primitives: readonly RenderPrimitive[]): Set<string> {
  const ids = new Set(primitives.filter((primitive) =>
    isAnswerLabel(document, {
      id: primitive.id,
      entityId: primitive.entityId,
      text: primitive.text,
      annotationId: typeof primitive.provenance?.annotationId === "string" ? primitive.provenance.annotationId : undefined,
    }),
  ).map((primitive) => primitive.id));
  const measurementOwners = answerMeasurementOwners(document);
  for (const primitive of primitives) {
    if (measurementOwners.has(primitive.entityId) && (primitive.kind === "dimension" || primitive.provenance?.measurementRole === "witness")) ids.add(primitive.id);
    // The compiler names a leader after the exact label placement it owns.
    // Checking both its role and existing owner avoids unrelated id suffixes.
    if (primitive.provenance?.labelLeader === true && primitive.id.endsWith("_leader") && ids.has(primitive.id.slice(0, -"_leader".length))) ids.add(primitive.id);
  }
  return ids;
}

/**
 * Old admitted recordings retain their audio and commands. Project only held
 * engine labels out of trusted intro ink; the completed-turn flush restores
 * them from the current verified presentation. Work and geometry stay intact.
 */
export function withoutEarlyAnswerLabels(document: SceneDocument, commands: readonly DrawCommand[]): DrawCommand[] {
  const annotations = new Set(document.annotations.filter((annotation) => isAnswerLabel(document, { id: annotation.id })).map((annotation) => annotation.id));
  const held = new Set(annotations);
  const measurements = answerMeasurementOwners(document);
  for (const entity of document.entities) {
    const quantity = componentQuantity(document, entity.id);
    const value = typeof quantity?.label === "string" ? quantity.label.trim() :
      typeof quantity?.value === "number" || typeof quantity?.value === "string" ? `${quantity.value}${typeof quantity.unit === "string" && !/^(?:1|dimensionless)$/i.test(quantity.unit.trim()) ? ` ${quantity.unit.trim()}` : ""}` : "";
    const combined = `${entity.label} ${value}`;
    if (quantity && derived(quantity) && value && combined.length <= 16) held.add(`primitive_${entity.id}_label`);
  }
  const isInk = (command: DrawCommand): boolean => command.type.startsWith("DRAW_") ||
    ["LABEL", "DIMENSION", "ARROW", "UNDERLINE", "CIRCLE_AROUND", "HIGHLIGHT", "SCRIBBLE"].includes(command.type);
  for (const command of commands) {
    if (isInk(command) && isAnswerLabel(document, {
      id: command.semanticRef?.primitiveId,
      entityId: command.semanticRef?.entityId,
      text: command.text,
      annotationId: annotations.has(command.semanticRef?.entityId ?? "") ? command.semanticRef?.entityId : undefined,
    }) && command.semanticRef?.primitiveId) held.add(command.semanticRef.primitiveId);
  }
  return commands.filter((command) => {
    if (!isInk(command)) return true;
    const id = command.semanticRef?.primitiveId;
    if (annotations.has(command.semanticRef?.entityId ?? "")) return false;
    if (measurements.has(command.semanticRef?.entityId ?? "") && (command.type === "DIMENSION" || command.visualStyle?.measurementRole === "witness")) return false;
    if (!id) return true;
    if (held.has(id)) return false;
    return !(command.visualStyle?.labelLeader === true && id.endsWith("_leader") && held.has(id.slice(0, -"_leader".length)));
  });
}
