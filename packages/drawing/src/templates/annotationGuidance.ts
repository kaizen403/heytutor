/** Shared per-template prompt suffix for marking and positional accuracy. */
export const DIAGRAM_MARKING_GUIDANCE = `diagram marking rules (all visual problems):
- point labels must POINT at the exact spot, not sit on the line. put the [LABEL] a clear gap away from any line (offset the letter ~24 px above/beside the point) so the text stays readable and never traces over the geometry. one [LABEL] per [STEP], spoken immediately before it.
- label every named part while you explain it — F, C, O, u, v, forces, vertices, etc.
- when you state a distance, length, or numeric given, mark it in the same [STEP] with [DIMENSION:label,x1,y1,x2,y2,offset]. this renders as a thin dotted measurement bar that floats beside the span — it is NOT a box and never touches the geometry. the span (x1,y1)-(x2,y2) is exactly what you measure; offset 40–90 pushes the bar clear (positive = below a horizontal span, negative = above). stack multiple distance bars at increasing offsets so they never overlap.
- examples: object distance below the axis [DIMENSION:u = 30 cm,490,300,610,300,92]; focal length [DIMENSION:f = 15 cm,550,300,610,300,124]; image height beside the arrow [DIMENSION:h',760,300,760,240,-30].
- point names (C, F, O) sit a modest gap ABOVE the axis tick (~50 px text-top) and slightly beside the tick — never on the line, never touching it. if the runtime already marked C/F/O and u/f/v, do NOT re-emit [LABEL], [WRITE], or [DIMENSION] for them; only [CIRCLE_AROUND] the existing label text.
- ray and line endpoints must land on anchors and surfaces — aim within 20 px of template anchor centers; the app snaps nearby coordinates for accuracy.
- use [DIMENSION:...] for spans and [LABEL:...] for point names. keep full equation algebra on the left (x 90–400).`;

export function withDiagramMarkingGuidance(promptAddon: string): string {
  return `${promptAddon}\n${DIAGRAM_MARKING_GUIDANCE}`;
}
