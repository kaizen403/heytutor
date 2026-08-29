import { measureTextWidth } from "@heytutor/drawing";
import {
  boundsOverlap,
  obstaclesFromPrimitives,
  workColumnObstacle,
  type LabelBounds,
  type RenderPrimitive,
  type RenderScene,
  type SceneDocument,
} from "@heytutor/scene-engine";
import { buildVerifiedDiagramPresentation } from "@/features/tutor-session/lib/verifiedScenePresentation";

/**
 * Labels must never be painted onto ink.
 *
 * The presentation adapter used to place annotation labels with a private list
 * of ten fixed offsets scored only against other labels — so a label could sit
 * squarely on the line it named. Placement now goes through the scene engine's
 * solver with the real ink as obstacles; this asserts the outcome on a scene
 * busy enough that a naive guess would collide.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const LABEL_FONT_PX = 24;
const LABEL_HEIGHT = 32;

function labelBoundsOf(command: { params: number[]; text?: string }): LabelBounds {
  const [x, y] = command.params;
  return {
    x: x!,
    y: y!,
    width: Math.max(measureTextWidth(command.text ?? "", LABEL_FONT_PX), 14),
    height: LABEL_HEIGHT,
  };
}

// A crowded figure: a triangle, a circle, two rays through the middle, and a
// labelled point on each vertex — every naive offset around a vertex is
// blocked by at least one stroke.
const primitives: RenderPrimitive[] = [
  { id: "p_tri", entityId: "tri", groupId: "g", kind: "polygon", points: [
    { x: 520, y: 200 }, { x: 760, y: 200 }, { x: 640, y: 400 },
  ] },
  { id: "p_circ", entityId: "circ", groupId: "g", kind: "circle", points: [{ x: 640, y: 300 }], radius: 70 },
  { id: "p_ray1", entityId: "r1", groupId: "g", kind: "vector", points: [{ x: 430, y: 300 }, { x: 1100, y: 300 }] },
  { id: "p_ray2", entityId: "r2", groupId: "g", kind: "vector", points: [{ x: 520, y: 200 }, { x: 1000, y: 460 }] },
  { id: "p_v1", entityId: "v1", groupId: "g", kind: "point", points: [{ x: 520, y: 200 }] },
  { id: "p_v2", entityId: "v2", groupId: "g", kind: "point", points: [{ x: 760, y: 200 }] },
  { id: "p_v3", entityId: "v3", groupId: "g", kind: "point", points: [{ x: 640, y: 400 }] },
  { id: "p_l1", entityId: "v1", groupId: "g", kind: "label", points: [{ x: 520, y: 200 }], text: "P", labelPlacement: "above" },
  { id: "p_l2", entityId: "v2", groupId: "g", kind: "label", points: [{ x: 760, y: 200 }], text: "Q", labelPlacement: "above" },
  { id: "p_l3", entityId: "v3", groupId: "g", kind: "label", points: [{ x: 640, y: 400 }], text: "R", labelPlacement: "below" },
  { id: "p_l4", entityId: "circ", groupId: "g", kind: "label", points: [{ x: 640, y: 300 }], text: "O", labelPlacement: "right" },
  { id: "p_l5", entityId: "r1", groupId: "g", kind: "label", points: [{ x: 700, y: 300 }], text: "axis" },
];

const document: SceneDocument = {
  schemaVersion: "scene-document/v2",
  id: "label_accuracy",
  entities: [
    { id: "tri", kind: "polygon", role: "shape" },
    { id: "circ", kind: "circle", role: "shape" },
    { id: "r1", kind: "vector", role: "ray" },
    { id: "r2", kind: "vector", role: "ray" },
    { id: "v1", kind: "point", role: "vertex" },
    { id: "v2", kind: "point", role: "vertex" },
    { id: "v3", kind: "point", role: "vertex" },
  ],
  constructions: [],
  relations: [],
  assertions: [],
  quantities: [],
  revealGroups: [{
    id: "g",
    label: "figure",
    narrationCue: "here is the figure",
    entityIds: ["tri", "circ", "r1", "r2", "v1", "v2", "v3"],
  }],
  teachingTimeline: [{ action: "reveal", targetId: "g" }],
} as unknown as SceneDocument;

const renderScene: RenderScene = {
  engineVersion: "scene-engine/2.0.0",
  primitives,
  revealGroups: document.revealGroups,
  timeline: document.teachingTimeline,
  entityBounds: {},
};

const presentation = buildVerifiedDiagramPresentation(document, renderScene);
const labelCommands = presentation.diagram.commands.filter((command) => command.type === "LABEL");
assert(labelCommands.length >= 4, `expected the figure's labels, got ${labelCommands.length}`);

// --- a label is never drawn on top of ink --------------------------------
const inkObstacles = obstaclesFromPrimitives(primitives.filter((p) => p.kind !== "label"));
for (const command of labelCommands) {
  const bounds = labelBoundsOf(command);
  for (const obstacle of inkObstacles) {
    if (!boundsOverlap(bounds, obstacle.bounds, 0)) continue;
    // A coarse bbox hit is only a real collision if the ink itself crosses it.
    if (!obstacle.segments || obstacle.segments.length === 0) {
      throw new Error(`label "${command.text}" sits on ${obstacle.id}`);
    }
    const crosses = obstacle.segments.some(([a, b]) => {
      // Sample the segment; any sample inside the label box is a collision.
      for (let t = 0; t <= 1; t += 0.02) {
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        if (px >= bounds.x && px <= bounds.x + bounds.width && py >= bounds.y && py <= bounds.y + bounds.height) {
          return true;
        }
      }
      return false;
    });
    assert(!crosses, `label "${command.text}" is painted over the ink of ${obstacle.id}`);
  }
}

// --- labels never collide with each other --------------------------------
for (let i = 0; i < labelCommands.length; i++) {
  for (let j = i + 1; j < labelCommands.length; j++) {
    const a = labelBoundsOf(labelCommands[i]!);
    const b = labelBoundsOf(labelCommands[j]!);
    assert(
      !boundsOverlap(a, b, 0),
      `labels "${labelCommands[i]!.text}" and "${labelCommands[j]!.text}" overlap each other`,
    );
  }
}

// --- labels stay out of the work column and inside the board -------------
const workColumn = workColumnObstacle();
for (const command of labelCommands) {
  const bounds = labelBoundsOf(command);
  assert(
    !boundsOverlap(bounds, workColumn.bounds, 0),
    `label "${command.text}" leaked into the work column at x=${bounds.x}`,
  );
  assert(bounds.x >= 400, `label "${command.text}" is left of the diagram zone`);
  assert(bounds.y >= 40, `label "${command.text}" is above the board`);
  assert(bounds.y + bounds.height <= 700, `label "${command.text}" runs off the bottom`);
}

// --- a label reserves the width it actually draws ------------------------
{
  const wide = labelCommands.find((command) => command.text === "axis");
  assert(wide, "the axis label should be emitted");
  assert(wide!.params[2] === LABEL_FONT_PX, `labels must render at ${LABEL_FONT_PX}px, got ${wide!.params[2]}`);
  // The old adapter measured at 32 px while rendering at 24 — a third too wide.
  const at24 = measureTextWidth("axis", 24);
  const at32 = measureTextWidth("axis", 32);
  assert(at32 > at24 * 1.2, "sanity: the two font sizes must differ enough to matter");
}

// --- every label still names its owner ------------------------------------
for (const command of labelCommands) {
  assert(command.anchorId, `label "${command.text}" lost its anchor entity`);
}

console.log(
  `verify-label-accuracy: ${labelCommands.length} labels placed clear of ink, clear of each other, inside the diagram zone`,
);
