import {
  BOARD_TYPE_STEPS,
  fitBoardText,
  workRowFontSize,
  WORK_ZONE,
  type DrawCommand,
} from "@heytutor/drawing";
import { TEXT_LAYOUT } from "../../constants";

/**
 * Captured work rows carry presentation, never diagram trust. Preserve only
 * work-role scale steps; raw teaching sizes are still discarded upstream.
 * A historical full-width size must not expand a narrow reopened column.
 */
export function fitRecordedWorkRow(text: string, maxWidth: number, recordedSize?: number) {
  const base = workRowFontSize(maxWidth);
  const fontSize = recordedSize !== undefined && BOARD_TYPE_STEPS.includes(recordedSize) && recordedSize <= base
    ? recordedSize
    : base;
  return fitBoardText(text, { role: "work", maxWidth, fontSize });
}

/** Server bounds captured WRITE presentation after teaching ownership checks. */
export function canonicalRecordedWorkWrite(command: DrawCommand): DrawCommand[] {
  const { fontSize, lines } = fitRecordedWorkRow(command.text ?? "", WORK_ZONE.fullWidthTextWidth, command.params[2]);
  const bottom = TEXT_LAYOUT.bottomY - TEXT_LAYOUT.textHeight;
  const y = Math.min(Math.max(command.params[1]!, TEXT_LAYOUT.topY), bottom);
  return lines.map((text, index) => ({
    ...command,
    text,
    params: [TEXT_LAYOUT.marginX, Math.min(y + index * TEXT_LAYOUT.lineHeight, bottom), fontSize],
  }));
}
