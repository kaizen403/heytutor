import type { DrawCommand } from "./drawingProtocol";
import type { VerifiedDiagram, VerifiedDiagramAnchor, VerifiedDiagramCommand } from "./verifiedDiagram";

export type FocusEmphasis = "trace" | "spotlight" | "pulse";

export interface SemanticFocusSpec {
  targetIds: string[];
  emphasis: FocusEmphasis;
}

export type WorkRowSelector =
  | { kind: "last" }
  | { kind: "index"; index: number }
  | { kind: "id"; id: string };

export interface WorkAreaRow {
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  workIndex?: number;
  workId?: string;
}

const EMPHASIS_ALIASES: Record<string, FocusEmphasis> = {
  trace: "trace",
  spotlight: "spotlight",
  dim: "spotlight",
  pulse: "pulse",
  group: "trace",
};

export function parseFocusSpec(raw: string | undefined): SemanticFocusSpec {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { targetIds: [], emphasis: "trace" };
  const [idsPart, emphasisPart] = trimmed.split("|", 2);
  const targetIds = (idsPart ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const emphasis = EMPHASIS_ALIASES[(emphasisPart ?? "").trim().toLowerCase()] ?? "trace";
  return { targetIds, emphasis };
}

export function parseWorkRowSelector(raw: string | undefined): WorkRowSelector | null {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (!trimmed) return { kind: "last" };
  if (trimmed === "last" || trimmed === "prev" || trimmed === "previous") return { kind: "last" };
  const indexed = /^(?:w|step|line|row)?(\d+)$/.exec(trimmed);
  if (indexed) return { kind: "index", index: Number(indexed[1]) };
  return { kind: "id", id: trimmed };
}

export function workRowsOf(rects: readonly WorkAreaRow[]): WorkAreaRow[] {
  return rects.filter((rect) => rect.workIndex != null || rect.workId != null);
}

export function resolveWorkAreaRow(
  selector: WorkRowSelector | null,
  rects: readonly WorkAreaRow[],
): WorkAreaRow | null {
  const rows = workRowsOf(rects);
  const pool = rows.length > 0 ? rows : rects.filter((rect) => Boolean(rect.text) && rect.x < 400);
  if (pool.length === 0 || !selector) return null;
  if (selector.kind === "last") return pool.at(-1) ?? null;
  if (selector.kind === "index") {
    return pool.find((row) => row.workIndex === selector.index) ?? pool[selector.index - 1] ?? null;
  }
  const wanted = selector.id;
  return pool.find((row) =>
    row.workId?.toLowerCase() === wanted ||
    row.text?.trim().toLowerCase() === wanted,
  ) ?? null;
}

export function resolveVerifiedDiagramFocusTargets(
  command: DrawCommand,
  diagram: VerifiedDiagram | null,
): VerifiedDiagramAnchor[] {
  if (!diagram || (command.type !== "FOCUS" && command.type !== "ANNOTATE")) return [];
  const spec = parseFocusSpec(command.semanticRef?.entityId ?? command.text);
  const wanted = spec.targetIds.length > 0
    ? spec.targetIds
    : [(command.semanticRef?.entityId ?? command.text ?? "").trim()].filter(Boolean);
  const matches: VerifiedDiagramAnchor[] = [];
  for (const raw of wanted) {
    const requested = raw.trim().toLowerCase();
    if (!requested) continue;
    const group = diagram.groups?.find((candidate) => candidate.id.toLowerCase() === requested);
    if (group) {
      for (const entityId of group.entityIds) {
        const member = diagram.anchors.find((anchor) => anchor.id === entityId);
        if (member && !matches.some((existing) => existing.id === member.id)) matches.push(member);
      }
      continue;
    }
    const anchor = diagram.anchors.find((candidate) =>
      candidate.id.toLowerCase() === requested ||
      candidate.labels.some((label) => label.trim().toLowerCase() === requested),
    );
    if (anchor && !matches.some((existing) => existing.id === anchor.id)) matches.push(anchor);
  }
  return matches;
}

export function resolveVerifiedDiagramFocusTarget(
  command: DrawCommand,
  diagram: VerifiedDiagram | null,
): VerifiedDiagramAnchor | null {
  return resolveVerifiedDiagramFocusTargets(command, diagram)[0] ?? null;
}

export function focusEmphasisOf(command: DrawCommand): FocusEmphasis {
  return parseFocusSpec(command.semanticRef?.entityId ?? command.text).emphasis;
}

export function takeDeferredAnnotations(
  diagram: VerifiedDiagram,
  trigger: { entityIds?: readonly string[]; text?: string },
): VerifiedDiagramCommand[] {
  if (!diagram.deferredAnnotations || diagram.deferredAnnotations.length === 0) return [];
  const entityIds = new Set((trigger.entityIds ?? []).map((id) => id.toLowerCase()));
  const haystack = (trigger.text ?? "").toLowerCase().replace(/\s+/g, "");
  const taken: VerifiedDiagramCommand[] = [];
  diagram.deferredAnnotations = diagram.deferredAnnotations.filter((entry) => {
    const matchesEntity = entityIds.has(entry.entityId.toLowerCase()) ||
      entry.entityId.split(",").some((id) => entityIds.has(id.trim().toLowerCase()));
    const matchesText = haystack.length > 0 && entry.commands.some((command) => {
      const label = (command.text ?? "").toLowerCase().replace(/\s+/g, "");
      return label.length > 0 && (haystack.includes(label) || label.includes(haystack.slice(0, 12)));
    });
    if (!matchesEntity && !matchesText) return true;
    taken.push(...entry.commands);
    return false;
  });
  return taken;
}

export function remainingDeferredAnnotations(diagram: VerifiedDiagram): VerifiedDiagramCommand[] {
  const leftover = diagram.deferredAnnotations?.flatMap((entry) => entry.commands) ?? [];
  if (diagram.deferredAnnotations) diagram.deferredAnnotations = [];
  return leftover;
}

function distanceToSegment(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const span = dx * dx + dy * dy;
  if (span < 1e-6) return Math.hypot(x - x1, y - y1);
  const t = Math.min(1, Math.max(0, ((x - x1) * dx + (y - y1) * dy) / span));
  return Math.hypot(x - (x1 + dx * t), y - (y1 + dy * t));
}

function commandDistance(x: number, y: number, command: VerifiedDiagramCommand): number {
  const params = command.params;
  if (command.type === "LABEL" || command.type === "WRITE") {
    const left = params[0];
    const top = params[1];
    if (![left, top].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
    const width = Math.max(18, (command.text?.length ?? 1) * 7);
    const height = 18;
    const dx = x < left! ? left! - x : x > left! + width ? x - (left! + width) : 0;
    const dy = y < top! ? top! - y : y > top! + height ? y - (top! + height) : 0;
    return Math.hypot(dx, dy);
  }
  if (command.type === "DRAW_POINT" || command.type === "DRAW_CIRCLE") {
    const cx = params[0];
    const cy = params[1];
    const radius = command.type === "DRAW_CIRCLE" ? (params[2] ?? 0) : 6;
    if (![cx, cy].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.hypot(x - cx!, y - cy!) - radius);
  }
  if (command.type === "DRAW_ARC") {
    const cx = params[0];
    const cy = params[1];
    const radius = params[2];
    const startDeg = params[3];
    const endDeg = params[4];
    if (![cx, cy, radius].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
    if (![startDeg, endDeg].every(Number.isFinite)) {
      return Math.abs(Math.hypot(x - cx!, y - cy!) - radius!);
    }
    let sweep = endDeg! - startDeg!;
    while (sweep > 180) sweep -= 360;
    while (sweep < -180) sweep += 360;
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index <= 16; index++) {
      const angle = (startDeg! + sweep * (index / 16)) * Math.PI / 180;
      best = Math.min(
        best,
        Math.hypot(x - (cx! + radius! * Math.cos(angle)), y - (cy! + radius! * Math.sin(angle))),
      );
    }
    return best;
  }
  const pairCount = command.type === "DIMENSION" ? 4 : params.length % 2 === 1 ? params.length - 1 : params.length;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 3 < pairCount; index += 2) {
    const x1 = params[index];
    const y1 = params[index + 1];
    const x2 = params[index + 2];
    const y2 = params[index + 3];
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    best = Math.min(best, distanceToSegment(x, y, x1!, y1!, x2!, y2!));
  }
  if (command.type === "DRAW_RECT" && params.length >= 4) {
    const left = params[0]!;
    const top = params[1]!;
    const right = left + params[2]!;
    const bottom = top + params[3]!;
    const dx = x < left ? left - x : x > right ? x - right : 0;
    const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

export function hitTestVerifiedAnchor(
  x: number,
  y: number,
  diagram: VerifiedDiagram,
  maxDistance = 18,
): VerifiedDiagramAnchor | null {
  let best: { anchor: VerifiedDiagramAnchor; distance: number } | null = null;
  for (const anchor of diagram.anchors) {
    const related = diagram.commands.filter((command) =>
      command.semanticRef?.entityId === anchor.id && command.visualStyle?.strokeRole !== "trace",
    );
    let distance = Number.POSITIVE_INFINITY;
    if (related.length > 0) {
      for (const command of related) {
        distance = Math.min(distance, commandDistance(x, y, command));
      }
    } else {
      const dx = x < anchor.x ? anchor.x - x : x > anchor.x + anchor.width ? x - (anchor.x + anchor.width) : 0;
      const dy = y < anchor.y ? anchor.y - y : y > anchor.y + anchor.height ? y - (anchor.y + anchor.height) : 0;
      distance = Math.hypot(dx, dy);
    }
    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { anchor, distance };
    }
  }
  return best?.anchor ?? null;
}
