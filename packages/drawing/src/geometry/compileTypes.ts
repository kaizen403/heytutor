import type { DrawCommandType, TutorSegment } from "../drawingProtocol";
import { getSegmentCommands } from "../drawingProtocol";
import type { TemplateAnchor, TemplateCommand } from "../templates/types";
import { templateToDrawCommand } from "../templates/registry";
import type { SceneKind, SceneSpec } from "./sceneSpec";

export interface CompiledScene {
  ok: boolean;
  residual: number;
  commands: TemplateCommand[];
  anchors: TemplateAnchor[];
  introSegments: TutorSegment[];
  promptAddon: string;
  diagramType: string;
  kind: SceneKind;
  allowLlmDrawInDiagramZone: boolean;
  plugin: string;
  degradeReason?: string;
}

export interface CompileOptions {
  question?: string;
}

export type GeometryPlugin = (
  spec: SceneSpec,
  options: CompileOptions,
) => CompiledScene | null;

export function emptyCompiled(
  spec: SceneSpec,
  plugin: string,
  degradeReason?: string,
): CompiledScene {
  return {
    ok: false,
    residual: 999,
    commands: [],
    anchors: [],
    introSegments: [],
    promptAddon: spec.promptAddon,
    diagramType: spec.diagramType,
    kind: spec.kind,
    allowLlmDrawInDiagramZone: false,
    plugin,
    degradeReason,
  };
}

export function cmd(
  type: DrawCommandType,
  params: number[],
  text?: string,
  anchorId?: string,
): TemplateCommand {
  return { type, params: params.map((p) => Math.round(p)), text, anchorId };
}

export function segmentsFromCommands(
  commands: TemplateCommand[],
  narration: string,
): TutorSegment[] {
  if (commands.length === 0) return [];
  const drawCommands = commands.map((c) => templateToDrawCommand(c));
  return [
    {
      narration:
        narration.trim().length > 0
          ? narration
          : "here is the diagram setup on the board.",
      command: drawCommands[0] ?? null,
      commands: drawCommands,
      templateIntro: true,
    },
  ];
}

/**
 * Map SceneSpec.introPhases → TutorSegments using already-compiled commands.
 * Commands are matched by LABEL text / anchorId / entity id heuristics; unmatched
 * phases fall back to remaining unused commands in order.
 */
export function introSegmentsFromPhases(
  spec: SceneSpec,
  commands: TemplateCommand[],
): TutorSegment[] {
  const phases = spec.introPhases;
  if (!phases || phases.length === 0) {
    return segmentsFromCommands(commands, spec.introNarration);
  }

  const remaining = [...commands];
  const segments: TutorSegment[] = [];

  for (const phase of phases) {
    const matched: TemplateCommand[] = [];
    for (const entityId of phase.entityIds) {
      const idx = remaining.findIndex((command) => commandMatchesEntity(command, entityId, spec));
      if (idx >= 0) {
        matched.push(...remaining.splice(idx, 1));
      }
    }
    if (matched.length === 0 && remaining.length > 0) {
      matched.push(remaining.shift()!);
    }
    if (matched.length === 0) continue;
    const drawCommands = matched.map((c) => templateToDrawCommand(c));
    segments.push({
      narration: phase.narration,
      command: drawCommands[0] ?? null,
      commands: drawCommands,
      templateIntro: true,
    });
  }

  if (remaining.length > 0) {
    segments.push(...segmentsFromCommands(remaining, spec.introNarration || "finishing the diagram."));
  }

  return segments.length > 0
    ? segments
    : segmentsFromCommands(commands, spec.introNarration);
}

function commandMatchesEntity(
  command: TemplateCommand,
  entityId: string,
  spec: SceneSpec,
): boolean {
  if (command.anchorId === entityId) return true;
  const entity = spec.entities.find((e) => e.id === entityId);
  if (entity?.text && command.text === entity.text) return true;
  if (command.text && command.text.toLowerCase() === entityId.toLowerCase()) return true;
  return false;
}

export function segmentsToCommands(segments: TutorSegment[]): TemplateCommand[] {
  return segments.flatMap((segment) =>
    getSegmentCommands(segment).map((c) => ({
      type: c.type,
      params: [...c.params],
      text: c.text,
    })),
  );
}

export function anchorsFromLabelCommands(commands: TemplateCommand[]): TemplateAnchor[] {
  const anchors: TemplateAnchor[] = [];
  for (const command of commands) {
    if (command.type !== "LABEL" || !command.text) continue;
    const [x, y] = command.params;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const id = command.anchorId ?? command.text.replace(/\s+/g, "_").slice(0, 24);
    anchors.push({
      id,
      labels: [command.text],
      x: Math.round(x - 12),
      y: Math.round(y - 12),
      width: Math.max(24, command.text.length * 10),
      height: 28,
    });
  }
  return anchors;
}

export function buildPromptAddon(spec: SceneSpec, anchorLines: string[]): string {
  const base = spec.promptAddon.trim();
  const anchors =
    anchorLines.length > 0
      ? `\nnamed anchors (do not redraw skeleton): ${anchorLines.join("; ")}.`
      : "";
  const openingRule =
    "\nif this question is a numerical/solve problem: no topic heading or title underline — diagram first, then algebra." +
    "\nif this question is a concept/topic explain: a short heading+underline at y 64 is ok; never insert a heading mid-solution.";
  const ban =
    "\ndo NOT redraw the diagram skeleton. explain, annotate, and write algebra on the left.";
  const hasBan = base.includes("do NOT redraw") || base.includes("do not redraw");
  const hasOpening = base.includes("heading+underline") || base.includes("no topic heading");
  return `${base}${anchors}${hasBan ? "" : ban}${hasOpening ? "" : openingRule}`;
}
