import { compileSceneDocument } from "./compiler";
import type { SceneDocument, SceneIssue } from "../types";

export type DiagramYieldPolicy = "off" | "verified_parts";
export function parseDiagramYieldPolicy(value: unknown): DiagramYieldPolicy {
  return value === "verified_parts" ? "verified_parts" : "off";
}

/** Remove only localized proof-failed text, then recompile from scratch.
 * No geometry, assertion, quantity, or required entity is removed. Unknown
 * errors and contradictory values keep their original fatal disposition.
 */
export function prepareVerifiedParts(
  original: SceneDocument,
  options: { enabled?: boolean } = {},
): { document: SceneDocument; issues: SceneIssue[] } {
  if (!options.enabled) return { document: original, issues: [] };
  const layoutProofCodes = new Set([
    "label_overlap_unresolved",
    "label_outside_view",
    "label_too_long",
  ]);
  let document = original;
  const issues: SceneIssue[] = [];
  // Bounded retries expose errors hidden behind an earlier failed label check.
  for (let pass = 0; pass < 4; pass++) {
    const compiled = compileSceneDocument(document);
    if (compiled.ok) break;
    // A secondary proof error on the same label cannot mask a measured lie.
    if (
      compiled.report.issues.some(
        (issue) => issue.severity === "fatal" && issue.failureKind === "truth",
      )
    )
      break;
    // A failed typed label check also produces generic display diagnostics for
    // otherwise valid labels on that output. Resolve the precise failure first,
    // then recompile before deciding whether those secondary labels lack proof.
    const preciseFailureIds = new Set(compiled.report.issues
      .filter((issue) => issue.code === "invalid_derived_value_label" && issue.failureKind === "proof")
      .flatMap((issue) => issue.entityIds ?? []));
    const proof = compiled.report.issues.filter((issue) =>
      issue.code !== "invalid_display_derived_claim" ||
      !issue.entityIds?.some((id) => preciseFailureIds.has(id)),
    ).filter(
      (issue) =>
        ([
          "invalid_derived_value_label",
          "invalid_display_derived_claim",
        ].includes(issue.code) &&
          issue.failureKind === "proof") ||
        issue.code === "annotation_geometry_unresolved" ||
        layoutProofCodes.has(issue.code),
    );
    if (!proof.length) break;
    // Removing a claim from an unproved named point can leave a false apex,
    // landing point or other positional answer on the board. Keep it blocked.
    const pointIds = new Set(
      document.entities
        .filter((entity) => entity.kind === "point")
        .map((entity) => entity.id),
    );
    if (
      proof.some(
        (issue) =>
          !layoutProofCodes.has(issue.code) &&
          issue.proofKind !== "unit_declaration" &&
          issue.entityIds?.some((id) => pointIds.has(id)),
      )
    )
      break;
    const next = structuredClone(document);
    let changed = false;
    const annotations = new Set<number>();
    for (const issue of proof) {
      const entity = /^entities\[(\d+)\]\.label$/.exec(issue.path ?? "");
      const annotation = /^annotations\[(\d+)\]\.(?:text|quantityId)$/.exec(
        issue.path ?? "",
      );
      if (entity && next.entities[Number(entity[1])]?.label) {
        delete next.entities[Number(entity[1])]!.label;
      } else if (
        annotation &&
        ["label", "callout", "badge"].includes(
          next.annotations[Number(annotation[1])]?.kind ?? "",
        )
      ) {
        annotations.add(Number(annotation[1]));
      } else if (layoutProofCodes.has(issue.code)) {
        // Layout diagnostics name the owner, not the text source. Only omit
        // an unambiguous entity label; never guess among several annotations.
        const owner = next.entities.find(
          (entity) => entity.id === issue.entityIds?.[0],
        );
        if (
          !owner?.label ||
          next.annotations.some(
            (annotation) =>
              annotation.targetIds.includes(owner.id) &&
              ["label", "callout"].includes(annotation.kind),
          )
        )
          continue;
        delete owner.label;
      } else if (issue.code === "annotation_geometry_unresolved") {
        const index = next.annotations.findIndex(
          (annotation) =>
            annotation.id === issue.entityIds?.[0] &&
            ["label", "callout", "badge", "sense"].includes(annotation.kind),
        );
        if (index < 0) continue;
        annotations.add(index);
      } else continue;
      changed = true;
      issues.push({
        code: "yield_label_omitted",
        severity: "warning",
        failureKind: "proof",
        ...(issue.path ? { path: issue.path } : {}),
        ...(issue.entityIds ? { entityIds: issue.entityIds } : {}),
        expected: issue.code,
        message: `Omitted unproved label: ${issue.message}`,
      });
    }
    if (!changed) break;
    const removedIds = new Set(
      next.annotations
        .filter((_, index) => annotations.has(index))
        .map((a) => a.id),
    );
    next.annotations = next.annotations.filter(
      (_, index) => !annotations.has(index),
    );
    next.teachingTimeline = next.teachingTimeline.filter(
      (action) => !removedIds.has(action.targetId),
    );
    document = next;
  }
  return { document, issues };
}
