import { compileSceneDocument } from "./compiler";
import type { CompileResult, SceneDocument, SceneIssue } from "../types";
import { withDiagramYieldPolicy } from "./yieldPolicy";

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
): { document: SceneDocument; issues: SceneIssue[]; compiledScene?: CompileResult } {
  const admitted = withDiagramYieldPolicy(original, options.enabled ? "verified_parts" : "off");
  if (!options.enabled) return { document: admitted, issues: [] };
  const layoutProofCodes = new Set([
    "label_overlap_unresolved",
    "label_outside_view",
    "label_too_long",
    "label_owner_ambiguous",
  ]);
  let document = admitted;
  const issues: SceneIssue[] = [];
  let compiledScene: CompileResult | undefined;
  // Bounded retries expose errors hidden behind an earlier failed label check.
  for (let pass = 0; pass < 6; pass++) {
    const compiled = compileSceneDocument(document);
    compiledScene = compiled;
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
        issue.code === "equation_label_unbound_parameter" ||
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
      } else if (entity && next.entities[Number(entity[1])] && layoutProofCodes.has(issue.code)) {
        // The label was generated during compilation (an inferred point name or
        // an operator's value label); stop generating it.
        const id = next.entities[Number(entity[1])]!.id;
        const previous = Array.isArray(next.source.yieldUnlabelledPoints) ? next.source.yieldUnlabelledPoints : [];
        if (previous.includes(id)) continue;
        next.source = { ...next.source, yieldUnlabelledPoints: [...previous, id] };
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
          !owner ||
          next.annotations.some(
            (annotation) =>
              annotation.targetIds.includes(owner.id) &&
              ["label", "callout"].includes(annotation.kind),
          )
        )
          continue;
        if (owner.label) {
          delete owner.label;
        } else {
          // Placement reports the entity owner even when its text was generated
          // by an operator and is absent from the input document.
          const previous = Array.isArray(next.source.yieldUnlabelledPoints) ? next.source.yieldUnlabelledPoints : [];
          if (previous.includes(owner.id)) continue;
          next.source = { ...next.source, yieldUnlabelledPoints: [...previous, owner.id] };
        }
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
    const removedActions = new Map(next.teachingTimeline
      .filter(action => removedIds.has(action.targetId))
      .map(action => [action.id, action]));
    // Preserve the partial order through omitted annotation actions. Merely
    // deleting their edges loses prerequisites; retaining them leaves dangling IDs.
    const dependencies = new Map<string, Set<string>>();
    const visiting = new Set<string>();
    const survivingDependencies = (id: string): Set<string> => {
      const cached = dependencies.get(id);
      if (cached) return cached;
      const removed = removedActions.get(id);
      // Compilation rejects cycles before recovery. Keep a cyclic reference
      // unresolved if one reaches this traversal; never erase a false order.
      if (!removed || visiting.has(id)) return new Set([id]);
      visiting.add(id);
      const survivors = new Set<string>();
      for (const dependency of removed.dependsOn) {
        for (const predecessor of survivingDependencies(dependency)) survivors.add(predecessor);
      }
      visiting.delete(id);
      dependencies.set(id, survivors);
      return survivors;
    };
    next.teachingTimeline = next.teachingTimeline
      .filter(action => !removedActions.has(action.id))
      .map(action => action.dependsOn.some(id => removedActions.has(id)) ? {
        ...action,
        dependsOn: [...new Set(action.dependsOn.flatMap(id => [...survivingDependencies(id)]))],
      } : action);
    // An omitted label leaves its point unlabelled, which is not false. Drop
    // the engine's "must stay labeled" claim for points that lost every label.
    const stillLabelled = (id: unknown) => next.entities.some((entity) => entity.id === id && entity.label) ||
      next.annotations.some((annotation) => annotation.targetIds.includes(String(id)) && ["label", "callout"].includes(annotation.kind));
    // Only the engine's own named-point claim; an explicit planner obligation stays.
    const droppedLabelClaims = next.assertions.filter((assertion) => assertion.predicate === "label_attached" && assertion.entities.length === 1
      && assertion.id === `assert_label_${assertion.entities[0]}` && (assertion as { reason?: unknown }).reason === "student-facing points must stay labeled"
      && !stillLabelled(assertion.entities[0]));
    if (droppedLabelClaims.length) {
      next.assertions = next.assertions.filter((assertion) => !droppedLabelClaims.includes(assertion));
      issues.push(...droppedLabelClaims.map((assertion): SceneIssue => ({ code: "yield_label_claim_dropped", severity: "warning", failureKind: "proof", entityIds: [...assertion.entities], message: `Label claim ${assertion.id} dropped with its omitted label` })));
    }
    document = next;
    compiledScene = undefined;
  }
  // The last retry may have changed the document. Return only a compilation
  // of the exact surviving scene, so admission can reuse its complete proofs.
  return { document, issues, compiledScene: compiledScene ?? compileSceneDocument(document) };
}
