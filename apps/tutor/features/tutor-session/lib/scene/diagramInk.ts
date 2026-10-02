import type { DrawCommand, VerifiedDiagram, VerifiedDiagramCommand } from "@heytutor/drawing";

/** Worked examples omit marker scaffolding, while keeping measured spans. */
export function isDsaConstructionGuide(command: Pick<DrawCommand, "visualStyle">): boolean {
  return command.visualStyle?.dashed === true
    && command.visualStyle.strokeRole === "construction"
    && command.visualStyle.measurementRole === undefined;
}

/** Select existing figure ink for a transient tutor trace. */
export function isFocusTraceInk(command: Pick<DrawCommand, "type" | "visualStyle">): boolean {
  return command.visualStyle?.strokeRole !== "trace"
    && command.visualStyle?.measurementRole !== "witness"
    && command.visualStyle?.labelLeader !== true
    && command.type !== "LABEL"
    && command.type !== "WRITE";
}

/** The entity's verified strokes, without its text or witness scaffolding. */
export function focusTraceCommands(diagram: VerifiedDiagram, entityIds: ReadonlySet<string>): VerifiedDiagramCommand[] {
  const measurements = new Set(diagram.commands
    .filter((command) => command.type === "DIMENSION")
    .map((command) => command.semanticRef?.entityId));
  return diagram.commands.filter((candidate) =>
    candidate.semanticRef?.entityId
    && entityIds.has(candidate.semanticRef.entityId)
    && !candidate.semanticRef.actionId
    && (!measurements.has(candidate.semanticRef.entityId) || candidate.type === "DIMENSION")
    && isFocusTraceInk(candidate),
  );
}
