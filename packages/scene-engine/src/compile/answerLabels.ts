import type { RenderScene, SceneDocument } from "../types";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import { ATOMIC_OPERATORS, evaluateAtomicConstruction } from "./atomicGeometry";
import { validationNumber } from "./sourceScalars";
import { atomicPropertyLabelOwner } from "./atomicPropertyLabelOwnership";

interface AtomicGeneratedLabelBinding { entityId: string; text: string; resultIds: string[]; operatorResultIds: string[]; hasUnboundComputedResult: boolean }

/** Regenerate label ownership from the same checked physical program. Render
 * provenance and serialized timing hints cannot declare a result to be setup. */
export function atomicGeneratedLabelBindings(document: SceneDocument): Map<string, AtomicGeneratedLabelBinding> {
  const labels = new Map<string, AtomicGeneratedLabelBinding>();
  for (const construction of document.constructions) {
    if (!(ATOMIC_OPERATORS as readonly string[]).includes(construction.operator)) continue;
    try {
      const values = evaluateAtomicConstruction(construction.operator, construction.inputs, {
        number: value => validationNumber(value, document), geometry: () => undefined,
        point: value => {
          if (typeof value !== "string" || !document.entities.some(entity => entity.id === value && entity.kind === "point")) throw new Error("Atomic origin must name a point");
          return { x: 0, y: 0 };
        },
      }, document);
      construction.outputs.forEach((entityId, index) => {
        const model = values[index]?.atomicObservable;
        model?.labels.forEach((label, labelIndex) => {
          const ownerId = atomicPropertyLabelOwner(document, construction, model, label.resultFields, entityId);
          if (!ownerId) return;
          labels.set(`${entityId}_physical_label_${labelIndex}`, {
          entityId: ownerId, text: label.text,
          resultIds: [...new Set((label.resultFields ?? []).flatMap(field => model.resultBindings?.[field] ? [model.resultBindings[field]!] : []))],
          operatorResultIds: [...new Set(Object.values(model.resultBindings ?? {}))],
          hasUnboundComputedResult: (label.resultFields ?? []).some(field => Object.hasOwn(model.values, field) && !model.resultBindings?.[field]),
          });
        });
      });
    } catch { /* An invalid physical program grants no timing classification. */ }
  }
  return labels;
}

/** Staging metadata grants no numeric authority. The complete candidate still
 * passes the existing quantity, source, evaluated-value and geometry proofs.
 */
export function deferVerifiedAnswerLabels(
  document: SceneDocument,
  plan: TurnPlanV3,
  renderScene?: RenderScene,
): SceneDocument {
  const key = (value: string) =>
    value
      .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (digit) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(digit)))
      .replace(/[_\s]/g, "")
      .toLowerCase();
  const names = new Set(
    [...plan.unknowns, ...plan.derived].flatMap((quantity) => [
      key(quantity.id),
      key(quantity.symbol),
    ]),
  );
  const isAnswer = (text: unknown) => {
    if (typeof text !== "string") return false;
    const normalized = text.replace(/−/g, "-");
    const claim = /^\s*([^=≈:]+)\s*[=≈:]/u.exec(normalized);
    if (claim && names.has(key(claim[1]!))) return true;
    // Unknown phrasing must not leak a numeric answer during the introduction.
    // Keep a plainly named given visible; conservatively stage other numeric
    // claims/coordinate tuples when the plan has answers to derive.
    if (names.size && ((claim && /\d/u.test(normalized)) || /^\s*[([]\s*[+-]?(?:\d|\.\d)/u.test(normalized))) {
      const given =
        claim &&
        plan.givens.find((quantity) =>
          [key(quantity.id), key(quantity.symbol)].includes(key(claim[1]!)),
        );
      if (!given) return true;
    }
    // Unit conversion and alternate numeric notation do not change whether a
    // value gives away an answer. Unnamed numeric labels are staged whenever
    // there is an answer to derive, including scientific notation and surds.
    return names.size > 0 && /^\s*[+-]?(?:\d|\.\d|√)/u.test(normalized);
  };
  const atomicLabels = atomicGeneratedLabelBindings(document);
  const atomicBinding = (primitive: { id: string; entityId: string; text?: string }) => {
    const binding = atomicLabels.get(primitive.id);
    return binding?.entityId === primitive.entityId && binding.text === primitive.text ? binding : undefined;
  };
  const primitiveIds = (renderScene?.primitives ?? []).filter(primitive => {
    const binding = atomicBinding(primitive);
    return binding?.hasUnboundComputedResult || binding?.resultIds.some(id => names.has(key(id)));
  }).map(primitive => primitive.id);
  const annotationAnswer = (annotation: SceneDocument["annotations"][number]) => {
    if (annotation.quantityId && plan.givens.some(quantity => quantity.id === annotation.quantityId)) return false;
    return isAnswer(annotation.text) || annotation.quantityId !== undefined && names.has(key(annotation.quantityId));
  };
  // Entries of a stated matrix (matrix_array) are givens, not computed answers;
  // hiding them would leave empty brackets. Computed matrices stay staged.
  const statedMatrices = new Set(document.constructions
    .filter((construction) => construction.operator === "matrix_array")
    .flatMap((construction) => construction.outputs));
  const entityIds = [
    ...new Set([
      ...(renderScene?.primitives ?? [])
        .filter((primitive) => !(primitive.provenance?.matrixCell && statedMatrices.has(primitive.entityId)))
        .filter((primitive) => !atomicBinding(primitive))
        .filter((primitive) => !primitive.provenance?.annotationId && isAnswer(primitive.text))
        .map((primitive) => primitive.entityId),
      ...document.entities
        .filter((entity) => isAnswer(entity.label))
        .map((entity) => entity.id),
      ...document.constructions
        .filter(
          (construction) =>
            construction.operator === "label" &&
            isAnswer(construction.inputs.text),
        )
        .flatMap((construction) => construction.outputs),
    ]),
  ];
  const annotationIds = [...new Set([
    ...(renderScene?.primitives ?? [])
      .filter((primitive) => primitive.provenance?.annotationId &&
        (document.annotations.some(annotation => annotation.id === primitive.provenance!.annotationId && annotationAnswer(annotation)) ||
          !document.annotations.some(annotation => annotation.id === primitive.provenance!.annotationId) && isAnswer(primitive.text)))
      .map((primitive) => String(primitive.provenance!.annotationId)),
    ...document.annotations
    .filter(
      annotationAnswer,
    )
    .map((annotation) => annotation.id),
  ])];
  if (!entityIds.length && !annotationIds.length && !primitiveIds.length) return document;
  return {
    ...document,
    source: {
      ...document.source,
      answerLabelEntityIds: entityIds,
      answerLabelAnnotationIds: annotationIds,
      answerLabelPrimitiveIds: primitiveIds,
    },
  };
}
