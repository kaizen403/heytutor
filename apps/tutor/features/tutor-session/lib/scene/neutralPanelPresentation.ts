import { getSegmentCommands, type VerifiedDiagramCommand, type VerifiedDiagramPresentation } from "@heytutor/drawing";
import { prepareSourceBoundChemistryStructure, type RenderPrimitive, type RenderScene, type SceneDocument, type SceneIssue } from "@heytutor/scene-engine";

/** A scoped visual refusal. Teaching and unrelated figure errors retain their own handling. */
export class NeutralPanelPresentationDeclined extends Error {
  readonly code = "neutral_panel_declined";
  constructor(readonly issues: readonly SceneIssue[]) {
    super(issues.map(issue => issue.message).join("; "));
    this.name = "NeutralPanelPresentationDeclined";
  }
}

function refused(message: string): never {
  throw new NeutralPanelPresentationDeclined([{ code: "neutral_panel_transport_declined", severity: "fatal", path: "presentation", message }]);
}

function transportKey(command: Pick<VerifiedDiagramCommand, "type" | "params" | "text" | "semanticRef" | "visualStyle">): string {
  return JSON.stringify([command.type, command.params, command.text ?? null, command.semanticRef?.entityId ?? null, command.semanticRef?.primitiveId ?? null, command.visualStyle ?? null]);
}

/** Runtime sidecar only: it is derived afresh from external source and raw geometry.
 * No supplied proof, role, family flag, document question or cache grants atomic labels. */
export function prepareNeutralPanelPresentation(
  document: SceneDocument,
  renderScene: RenderScene,
  originalQuestion: string | undefined,
): {
  isAtomicLabel(primitive: RenderPrimitive, command: VerifiedDiagramCommand): boolean;
  assertComplete(presentation: VerifiedDiagramPresentation): void;
} | null {
  // Undefined is deliberately passed through to the independently defensive factory.
  // The assertion changes only TypeScript's optional-call spelling, never source authority.
  const checked = prepareSourceBoundChemistryStructure({ originalQuestion: originalQuestion as string, rawDocument: document, compiledWitness: renderScene });
  if (checked.status === "not_applicable") return null;
  if (checked.status === "declined") throw new NeutralPanelPresentationDeclined(checked.issues);
  const labels = new Map(checked.labels.map(label => [label.primitiveId, label]));
  const primitives = new Map(checked.renderScene.primitives.map(primitive => [primitive.id, primitive]));

  function isAtomicLabel(primitive: RenderPrimitive, command: VerifiedDiagramCommand): boolean {
    const binding = labels.get(primitive.id);
    return Boolean(binding && primitive.kind === "label" && command.type === "LABEL" && command.text === binding.text && primitive.entityId === binding.entityId && primitive.groupId === binding.groupId);
  }

  function assertComplete(presentation: VerifiedDiagramPresentation): void {
    const commands = presentation.diagram.commands;
    const opening = presentation.introSegments.flatMap(segment => getSegmentCommands(segment));
    for (const primitive of primitives.values()) {
      const matches = commands.filter(command => command.semanticRef?.primitiveId === primitive.id && command.semanticRef.entityId === primitive.entityId);
      if (matches.length !== 1) refused(`missing_or_duplicate_structural_transport:${primitive.id}`);
      const command = matches[0]!;
      if (primitive.kind === "label") {
        const binding = labels.get(primitive.id);
        const bounds = primitive.provenance?.labelBounds as { x?: unknown; y?: unknown } | undefined;
        if (!binding || !isAtomicLabel(primitive, command) || typeof bounds?.x !== "number" || typeof bounds.y !== "number" || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || command.params.length !== 3 || command.params[0] !== bounds.x + 4 || command.params[1] !== bounds.y + 4 || command.params[2] !== 24) refused(`changed_structural_label_transport:${primitive.id}`);
      } else if (primitive.kind === "line") {
        if (command.type !== "DRAW_LINE" || JSON.stringify(command.params) !== JSON.stringify(primitive.points.flatMap(point => [point.x, point.y]))) refused(`changed_structural_bond_transport:${primitive.id}`);
      } else if (primitive.kind === "rectangle") {
        const xs = primitive.points.map(point => point.x), ys = primitive.points.map(point => point.y);
        const expected = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
        if (command.type !== "DRAW_RECT" || JSON.stringify(command.params) !== JSON.stringify(expected)) refused(`changed_structural_frame_transport:${primitive.id}`);
      } else refused(`unsupported_structural_transport:${primitive.id}`);
      if (opening.filter(item => transportKey(item) === transportKey(command)).length !== 1) refused(`missing_or_changed_opening_structure:${primitive.id}`);
    }
    if (commands.length !== primitives.size || opening.length !== commands.length) refused("unproved_extra_or_missing_neutral_transport");
  }
  return { isAtomicLabel, assertComplete };
}
