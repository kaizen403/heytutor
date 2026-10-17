import type { SceneDocument } from "../types";
import type { TurnPlanV3 } from "../contracts/contractsV3";

/** Staging metadata grants no numeric authority. The complete candidate still
 * passes the existing quantity, source, evaluated-value and geometry proofs.
 */
export function deferVerifiedAnswerLabels(
  document: SceneDocument,
  plan: TurnPlanV3,
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
  const entityIds = [
    ...new Set([
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
  const annotationIds = document.annotations
    .filter(
      (annotation) =>
        isAnswer(annotation.text) ||
        (annotation.quantityId !== undefined &&
          names.has(key(annotation.quantityId))),
    )
    .map((annotation) => annotation.id);
  if (!entityIds.length && !annotationIds.length) return document;
  return {
    ...document,
    source: {
      ...document.source,
      answerLabelEntityIds: entityIds,
      answerLabelAnnotationIds: annotationIds,
    },
  };
}
