import type { DrawCommand } from "@heytutor/drawing";
import { componentDesignatorQuantityCandidates, type RenderPrimitive, type SceneDocument } from "@heytutor/scene-engine";

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

/**
 * The quantity behind a component's combined label ("R 5 Ω"), read with the
 * compiler's own priority. Any doubt holds the label: more than one candidate
 * (a textless binding included), or any derived candidate.
 */
function componentQuantity(document: SceneDocument, entityId: string | undefined): { quantity?: Quantity; hold: boolean } {
  const entity = document.entities.find((candidate) => candidate.id === entityId);
  if (entity?.kind !== "component" || !entity.label || !/^[A-Za-z][A-Za-z0-9_₀-₉]{0,7}$/.test(entity.label)) return { hold: false };
  const bound = document.annotations.flatMap((annotation) =>
    annotation.kind === "label" && annotation.labelMode !== "append" && annotation.targetIds.length === 1 &&
    annotation.targetIds[0] === entity.id && annotation.quantityId !== undefined && !annotation.text
      ? document.quantities.filter((quantity) => quantity.id === annotation.quantityId)
      : []);
  const candidates = [...new Set([...componentDesignatorQuantityCandidates(entity.label, document.quantities), ...bound])];
  return { quantity: candidates.length === 1 ? candidates[0] : undefined, hold: candidates.length > 1 || candidates.some(derived) };
}
/** Reconstruct only the exact component annotation consumed by the compiler.
 * Historical recordings predate annotationId provenance on combined labels.
 */
function componentValueAnnotation(document: SceneDocument, entityId: string | undefined) {
  const entity = document.entities.find((candidate) => candidate.id === entityId);
  if (entity?.kind !== "component" || !entity.label || !/^[A-Za-z][A-Za-z0-9_₀-₉]{0,7}$/.test(entity.label.trim())) return undefined;
  return document.annotations.find((annotation) => annotation.kind === "label" &&
    annotation.targetIds.includes(entity.id) && Boolean(annotation.text) && annotation.text !== entity.label);
}
function consumedComponentAnnotation(document: SceneDocument, primitive: { id?: string; entityId?: string; text?: string }) {
  if (!primitive.entityId || primitive.id !== `primitive_${primitive.entityId}_label`) return undefined;
  const entity = document.entities.find((candidate) => candidate.id === primitive.entityId);
  const annotation = componentValueAnnotation(document, primitive.entityId);
  const combined = annotation ? `${entity!.label} ${annotation.text}` : "";
  return combined.length <= 16 && primitive.text === combined ? annotation : undefined;
}
type DisplayedMeasurement = { id?: string; entityId?: string; text?: string; annotationId?: string };
function answerMeasurementOwners(document: SceneDocument, measurements: readonly DisplayedMeasurement[]): Set<string> {
  return new Set(document.entities.filter((entity) => entity.kind === "dimension" &&
    !document.quantities.some((quantity) => quantity.provenance === "given" &&
      [quantity.id, symbolOf(quantity)].some((symbol) => symbolKey(symbol) === symbolKey((entity.label ?? "").split(/[=≈:]/u)[0]!))) &&
    !document.annotations.some((annotation) => annotation.kind !== "narration" && annotation.targetIds.includes(entity.id) &&
      document.quantities.some((quantity) => quantity.id === annotation.quantityId && quantity.provenance === "given")) &&
    measurements.some((measurement) => measurement.entityId === entity.id && Boolean(measurement.text) &&
      isAnswerLabel(document, measurement)),
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
  const consumed = consumedComponentAnnotation(document, primitive);
  const annotation = document.annotations.find((entry) => entry.id === (primitive.annotationId ?? primitive.id)) ?? consumed;
  if (annotation?.kind === "narration") return false;
  const source = document.source as Record<string, unknown>;
  // Engine staging hints affect timing only. Displayed givens, names and
  // placeholders still win; a hint never grants numeric authority.
  const staged = Array.isArray(source.answerLabelEntityIds) && source.answerLabelEntityIds.includes(primitive.entityId) ||
    Array.isArray(source.answerLabelAnnotationIds) && source.answerLabelAnnotationIds.includes(annotation?.id ?? primitive.annotationId);
  // Only unwrap a component prefix when its displayed text exactly matches
  // the compiler's consumed annotation; source prose never replaces a name.
  let text = (consumed && annotation?.id === consumed.id ? consumed.text : primitive.text) ?? annotation?.text ?? "";
  text = text.trim();
  let quantity = annotation?.quantityId ? document.quantities.find((entry) => entry.id === annotation.quantityId) : undefined;
  if (annotation?.quantityId && (!quantity || !derived(quantity))) return false;
  if (!annotation && primitive.entityId && primitive.id === `primitive_${primitive.entityId}_label`) {
    const entity = document.entities.find((candidate) => candidate.id === primitive.entityId);
    const component = componentQuantity(document, primitive.entityId);
    quantity = component.quantity;
    if (entity?.label && text.startsWith(`${entity.label} `)) {
      text = text.slice(entity.label.length).trim();
      // The compiler appended a value to the designator. An ambiguous or
      // derived binding is held as an answer rather than guessed as a given.
      if (component.hold && text && !/^[?？…_]/u.test(text)) return true;
    }
  }
  if (!text) return false;
  const assigned = /^\s*([^=≈:]{1,80})\s*[=≈:]\s*(.+)\s*$/u.exec(text);
  const rhs = (assigned?.[2] ?? text).trim();
  if (/^[?？…_]/u.test(rhs) || /^\(?\s*to\s+find\s*\)?(?:\s|$)/iu.test(rhs)) return false;
  const references = (name: string) => document.quantities.filter((entry) =>
    symbolKey(symbolOf(entry)) === symbolKey(name) || symbolKey(entry.id) === symbolKey(name));
  if (assigned) {
    const lhs = assigned[1]!.trim();
    // A qualifier can show a given assignment ("... at x = 5 m") without
    // displaying the derived quantity to which its annotation is bound.
    const named = references(lhs);
    const trailing = named.length ? named : references(lhs.split(/\s+/u).at(-1)!);
    if (trailing.length === 1 && !derived(trailing[0]!)) return false;
    if (!quantity) quantity = named.length === 1 ? named[0] : undefined;
    if (quantity ? !derived(quantity) : !staged) return false;
    // This is reveal timing, not an algebra parser: functions, implicit
    // products and Unicode operators all reveal an assigned result too.
    return /[\p{N}\p{L}\p{Sm}]/u.test(rhs);
  }
  if ((quantity ? !derived(quantity) : !staged) || /^[\p{L}_][\p{L}\p{N}_{}]*$/u.test(text)) return false;
  // A numeric literal must be separate from an identifier (Mode2 is a name).
  const numbers = [...text.matchAll(/(?<![\p{L}\p{N}_])[+−-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/gu)];
  if (!numbers.length) return false;
  if (quantity && /^[+−-]?\s*(?:\d|\.\d)/u.test(text)) return true;
  const unitKey = (value: string) => value.normalize("NFKC").replace(/[{}_^\s]/g, "");
  const measurementMatches = (entry: Quantity, number: RegExpMatchArray) => {
    if (Number(entry.value) !== Number(number[0].replace("−", "-"))) return false;
    const tail = unitKey(text.slice(number.index! + number[0].length));
    const unit = typeof entry.unit === "string" && !/^(?:1|dimensionless)$/i.test(entry.unit.trim()) ? unitKey(entry.unit) : "";
    return unit ? tail.startsWith(unit) && !/^[\p{L}\p{N}]/u.test(tail.slice(unit.length)) : !/^[\p{L}\p{N}]/u.test(tail);
  };
  // Prose mentioning only given measurements is setup ("After 5.0 s"). An
  // actual bound result measurement still wins even when a given coincides.
  return !numbers.every((number) => document.quantities.some((entry) => !derived(entry) && measurementMatches(entry, number))) ||
    Boolean(quantity && numbers.some((number) => measurementMatches(quantity, number)));
}

/** A label and its own compiled leader form one reveal; never its whole host. */
export function answerLabelPrimitiveIds(document: SceneDocument, primitives: readonly RenderPrimitive[]): Set<string> {
  // A result callout cannot override a given measurement. Only actual
  // displayed value labels can hold its geometry, never no-ink narration.
  const dimensionEntities = new Set(document.entities.filter((entity) => entity.kind === "dimension").map((entity) => entity.id));
  const measurementOwners = answerMeasurementOwners(document, primitives.filter((primitive) => primitive.kind === "dimension" || primitive.kind === "label")
    .map((primitive) => ({ ...primitive, annotationId: typeof primitive.provenance?.annotationId === "string" ? primitive.provenance.annotationId : undefined })));
  const ids = new Set(primitives.filter((primitive) =>
    primitive.kind === "dimension" && dimensionEntities.has(primitive.entityId) ? measurementOwners.has(primitive.entityId) :
    primitive.provenance?.labelLeader !== true && isAnswerLabel(document, {
      id: primitive.id,
      entityId: primitive.entityId,
      text: primitive.text,
      annotationId: typeof primitive.provenance?.annotationId === "string" ? primitive.provenance.annotationId : undefined,
    }),
  ).map((primitive) => primitive.id));
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
  const annotationIds = new Set(document.annotations.map((annotation) => annotation.id));
  const held = new Set<string>();
  const dimensionEntities = new Set(document.entities.filter((entity) => entity.kind === "dimension").map((entity) => entity.id));
  const barIds = new Set(commands.flatMap((command) => command.type === "DIMENSION" && dimensionEntities.has(command.semanticRef?.entityId ?? "") && command.semanticRef?.primitiveId ? [command.semanticRef.primitiveId] : []));
  const measurements = answerMeasurementOwners(document, commands.filter((command) =>
    Boolean(command.text) && (command.type === "LABEL" || command.type === "DIMENSION"),
  ).map((command) => ({ id: command.semanticRef?.primitiveId, entityId: command.semanticRef?.entityId, text: command.text })));
  const isInk = (command: DrawCommand): boolean => command.type.startsWith("DRAW_") ||
    ["LABEL", "DIMENSION", "ARROW", "UNDERLINE", "CIRCLE_AROUND", "HIGHLIGHT", "SCRIBBLE"].includes(command.type);
  for (const command of commands) {
    if (barIds.has(command.semanticRef?.primitiveId ?? "") && !measurements.has(command.semanticRef?.entityId ?? "")) continue;
    if (isInk(command) && command.visualStyle?.labelLeader !== true && isAnswerLabel(document, {
      id: command.semanticRef?.primitiveId,
      entityId: command.semanticRef?.entityId,
      text: command.text,
      annotationId: annotationIds.has(command.semanticRef?.entityId ?? "") ? command.semanticRef?.entityId : undefined,
    }) && command.semanticRef?.primitiveId) held.add(command.semanticRef.primitiveId);
  }
  return commands.filter((command) => {
    if (!isInk(command)) return true;
    const id = command.semanticRef?.primitiveId;
    if (measurements.has(command.semanticRef?.entityId ?? "") && (command.type === "DIMENSION" || command.visualStyle?.measurementRole === "witness")) return false;
    if (!id) return true;
    if (held.has(id)) return false;
    return !(command.visualStyle?.labelLeader === true && id.endsWith("_leader") && held.has(id.slice(0, -"_leader".length)));
  });
}
