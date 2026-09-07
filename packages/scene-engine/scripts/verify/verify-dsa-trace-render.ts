/**
 * Trace-versus-render gate.
 *
 * Compiling green is not the bar. This gate asserts the drawn picture says
 * what the algorithm did:
 *
 *   - every value the trace placed at an address is the text actually drawn
 *     against that entity (the Floyd-Warshall "3 in the wrong column" class);
 *   - every value label sits inside the box it belongs to (the "numbers
 *     touching the diagram" class);
 *   - no two labels overlap each other (the same class, between neighbours);
 *   - every frame fits the DSA diagram zone (the "frames overlap" class);
 *   - the tier is derived from the document's assertions, never asserted.
 *
 * `--render <dir>` writes every frame as SVG so the figures can be inspected
 * without a browser, the way verify-archetype-pictures does for physics.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ALGORITHM_FAMILIES } from "../../src/dsa/algorithmCatalog";
import { compileTraceScenes, traceRenderMismatches, type DsaFrameScene } from "../../src/dsa/traceToScene";
import type { TraceFrame } from "../../src/dsa/trace/types";
import type { RenderPrimitive } from "../../src/types";
import { renderSceneSvg } from "../lib/renderSceneSvg";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Frames one family may spend.
 *
 * This was 8, which is one frame per pass for an exchange sort and therefore
 * exactly the budget that made bubble sort unteachable: the comparisons and
 * swaps that are the algorithm all happened between two frames. A walk-through
 * that shows the operations needs room for them, and the pacing gate confirms
 * the resulting lesson still lands in the 6 to 10 minute band.
 */
const MAX_FRAMES_PER_FAMILY = 16;


/** The zone a DSA figure compiles into, mirroring DSA_DIAGRAM_ZONE in the app. */
const VIEWPORT = { x: 620, y: 90, width: 540, height: 460 };
const RIGHT = VIEWPORT.x + VIEWPORT.width;
const BOTTOM = VIEWPORT.y + VIEWPORT.height;
/** Compiled geometry may sit a hair outside from stroke rounding. */
const EDGE_SLACK = 1;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boundsOf(primitive: RenderPrimitive): Box | null {
  const points = (primitive as { points?: Array<{ x: number; y: number }> }).points ?? [];
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/** Where a label's glyph run actually lands, honouring the reserved box. */
function labelBox(primitive: RenderPrimitive): Box | null {
  const reserved = (primitive as { provenance?: { labelBounds?: unknown } }).provenance?.labelBounds;
  if (
    reserved &&
    typeof reserved === "object" &&
    typeof (reserved as Box).x === "number" &&
    typeof (reserved as Box).width === "number"
  ) {
    return reserved as Box;
  }
  const anchor = boundsOf(primitive);
  if (!anchor) return null;
  const text = (primitive as { text?: string }).text ?? "";
  // Fall back to a conservative estimate around the anchor point.
  return { x: anchor.x - text.length * 4.5, y: anchor.y - 8, width: text.length * 9, height: 16 };
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x - EDGE_SLACK &&
    inner.y >= outer.y - EDGE_SLACK &&
    inner.x + inner.width <= outer.x + outer.width + EDGE_SLACK &&
    inner.y + inner.height <= outer.y + outer.height + EDGE_SLACK
  );
}

const renderIndex = process.argv.indexOf("--render");
const renderDir = renderIndex >= 0 ? process.argv[renderIndex + 1] : null;
if (renderDir) mkdirSync(renderDir, { recursive: true });

let frameCount = 0;

for (const family of ALGORITHM_FAMILIES) {
  const run = family.run("");
  assert(run, `${family.id}: default example did not produce a trace`);

  const scenes = compileTraceScenes(run.trace, { question: family.title, compile: { viewport: VIEWPORT } });
  assert(scenes, `${family.id}: frames did not all compile — a partial walk-through must fail closed`);

  assert(scenes.frames.length >= 2, `${family.id}: needs at least two frames to be a walk-through`);
  assert(
    scenes.frames.length <= MAX_FRAMES_PER_FAMILY,
    `${family.id}: ${scenes.frames.length} frames exceeds the lesson budget`,
  );

  // The tier must be derived. A figure with no metric assertion can never be
  // exact, and hardcoding that string is what let the old builder claim a
  // verification it had not done.
  assert(
    scenes.tier === "qualitative_verified" && scenes.nonMetric,
    `${family.id}: expected a derived qualitative tier, got ${scenes.tier} (${scenes.tierReason})`,
  );

  // The crux: drawn text equals the trace value at every address.
  const mismatches = traceRenderMismatches(scenes);
  assert(
    mismatches.length === 0,
    `${family.id}: ${mismatches.length} value(s) drawn in the wrong place — ${JSON.stringify(mismatches.slice(0, 4))}`,
  );

  // Every frame of one walk-through must render its cells at the same size and
  // in the same place. Each frame is fitted to the zone independently, so a
  // frame that carries more furniture than its neighbours is scaled down and
  // the array visibly grows and shrinks as the walk advances. Nothing else
  // catches this: each frame on its own is perfectly valid.
  // `cell0` for a flat figure, `p0_cell0` for a stacked one: a stacked family
  // has no top-level `cell0`, so this check silently passed on every one of
  // them. Whichever id every frame shares is the one to measure.
  const scaleId = ["cell0", "p0_cell0", "node0", "row0col0"].find((id) =>
    scenes.frames.every((frame) => frame.renderScene.entityBounds[id] !== undefined),
  );
  const cellBoxes = scenes.frames.map((frame) =>
    scaleId ? frame.renderScene.entityBounds[scaleId] : undefined,
  );
  if (scaleId && cellBoxes.every((box) => box !== undefined)) {
    const first = cellBoxes[0]!;
    for (const [index, box] of cellBoxes.entries()) {
      assert(
        Math.abs(box!.width - first.width) <= 1 &&
          Math.abs(box!.x - first.x) <= 1 &&
          Math.abs(box!.y - first.y) <= 1,
        `${family.id}: frame ${index} draws ${scaleId} at ${box!.x.toFixed(0)},${box!.y.toFixed(0)} ` +
          `${box!.width.toFixed(0)}px wide but frame 0 draws it at ${first.x.toFixed(0)},${first.y.toFixed(0)} ` +
          `${first.width.toFixed(0)}px — the figure rescales between frames`,
      );
    }
  }

  // The check above only reaches `cell0`, which a stacked frame does not have
  // (its ids are prefixed `p0_`, `p1_`) and which says nothing about the
  // furniture hanging off the figure. Two real drifts got through it: a
  // stacked walk whose lower panel dropped 93px when a bracket appeared under
  // the upper one, and an insertion walk whose output row slid further down
  // the board on every frame as the tree deepened. Anything a student reads as
  // a fixed place has to be in a fixed place, so every id the whole walk
  // shares is checked, not one.
  {
    const shared = [...(scenes.frames[0]?.renderScene.entityBounds
      ? Object.keys(scenes.frames[0].renderScene.entityBounds)
      : [])].filter((id) =>
      scenes.frames.every((frame) => frame.renderScene.entityBounds[id] !== undefined),
    );
    // Scoped to the two things that hang off the figure rather than being it.
    // A cell of the main figure may legitimately move: merge sort's blocks
    // regroup as the array splits, and that is the algorithm, not drift. An
    // aside and a stacked panel have no such licence, and both were measured
    // moving for reasons that had nothing to do with the algorithm.
    //
    // Marks are excluded: a wash, a tick and a strike are different shapes on
    // the same cell, so `as_out0_mk` sits a pixel or two apart by design.
    const structural = shared.filter(
      (id) => /^(?:as_|p\d+_)/.test(id) && !/_mk$/.test(id),
    );
    for (const id of structural) {
      const first = scenes.frames[0]!.renderScene.entityBounds[id]!;
      for (const [index, frame] of scenes.frames.entries()) {
        const box = frame.renderScene.entityBounds[id]!;
        assert(
          Math.abs(box.x - first.x) <= 1.5 && Math.abs(box.y - first.y) <= 1.5,
          `${family.id}: ${id} sits at ${box.x.toFixed(0)},${box.y.toFixed(0)} in frame ${index} ` +
            `but at ${first.x.toFixed(0)},${first.y.toFixed(0)} in frame 0 — it drifts as the walk advances`,
        );
      }
    }
  }

  for (const [index, frame] of scenes.frames.entries()) {
    frameCount += 1;
    checkFrame(family.id, frame);
    checkArrayChannels(family.id, run.trace.frames[index]!, frame);
    if (renderDir) {
      writeFileSync(
        `${renderDir}/${family.id}-${frame.frameId}.svg`,
        renderSceneSvg(frame.renderScene, {
          title: `${scenes.title} — ${frame.frameId}`,
          subtitle: `${frame.caption} · ${scenes.tier}`,
        }),
      );
    }
  }
}

function checkFrame(familyId: string, frame: DsaFrameScene): void {
  const where = `${familyId}/${frame.frameId}`;
  const primitives = frame.renderScene.primitives;
  assert(primitives.length > 0, `${where}: compiled to an empty figure`);

  // Every frame is fitted independently, so each one must fit the zone on its
  // own. Stacking frames into one document is what made them overlap before.
  for (const primitive of primitives) {
    const box = boundsOf(primitive);
    if (!box) continue;
    assert(
      box.x >= VIEWPORT.x - EDGE_SLACK &&
        box.y >= VIEWPORT.y - EDGE_SLACK &&
        box.x + box.width <= RIGHT + EDGE_SLACK &&
        box.y + box.height <= BOTTOM + EDGE_SLACK,
      `${where}: ${primitive.kind} escapes the diagram zone at ${box.x.toFixed(0)},${box.y.toFixed(0)}`,
    );
  }

  // No dashed construction ink on a DSA figure. This is the "weird lines that
  // do not indicate anything" complaint, asserted rather than hoped for.
  for (const primitive of primitives) {
    const style = (primitive as { visualStyle?: { dashed?: boolean; strokeRole?: string } }).visualStyle;
    assert(style?.dashed !== true, `${where}: a dashed construction line reached a DSA figure`);
    assert(style?.strokeRole !== "trace", `${where}: a trace stroke reached a DSA figure`);
  }

  const labels = primitives.filter((primitive) => primitive.kind === "label");
  const shapes = primitives.filter((primitive) => primitive.kind !== "label");

  // A value belongs inside the box that owns it.
  for (const label of labels) {
    const entityId = label.entityId;
    if (!entityId || !(entityId in frame.expectedLabels)) continue;
    const owner = shapes.find((shape) => shape.entityId === entityId);
    if (!owner) continue;
    const ownerBox = boundsOf(owner);
    const textBox = labelBox(label);
    if (!ownerBox || !textBox) continue;
    // Circles carry their label at the centre; only closed boxes are checked
    // for containment, since a circle's bounding square is not its area.
    if (owner.kind !== "rectangle" && owner.kind !== "polygon") continue;
    assert(
      contains(ownerBox, textBox),
      `${where}: value "${frame.expectedLabels[entityId]}" spills out of ${entityId} ` +
        `(cell ${ownerBox.width.toFixed(0)}x${ownerBox.height.toFixed(0)}, text ${textBox.width.toFixed(0)}x${textBox.height.toFixed(0)})`,
    );
  }

  // Neighbouring values must not sit on top of each other.
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const a = labelBox(labels[i]!);
      const b = labelBox(labels[j]!);
      if (!a || !b) continue;
      if (labels[i]!.entityId && labels[i]!.entityId === labels[j]!.entityId) continue;
      assert(
        !overlaps(a, b),
        `${where}: labels "${(labels[i] as { text?: string }).text}" and ` +
          `"${(labels[j] as { text?: string }).text}" overlap`,
      );
    }
  }

  // Spotlight targets must name entities that exist in this frame.
  for (const entityId of frame.focusEntityIds) {
    assert(
      primitives.some((primitive) => primitive.entityId === entityId),
      `${where}: focus target ${entityId} is not in the compiled figure`,
    );
  }

  // The caption is the line the student reads under the figure, and the
  // teaching prompt quotes it to the tutor as what the board says. It has to
  // survive compilation: 71 of these 110 frames used to arrive with none,
  // because the validator folds `caption` into `callout` and any callout of
  // sixteen characters or fewer then looked like a label for some entity. The
  // frame that reads "11 + 15 = 26" — the answer — was one of them.
  assert(
    typeof frame.renderScene.caption === "string" &&
      frame.renderScene.caption.includes(frame.caption),
    `${where}: the board shows ${JSON.stringify(frame.renderScene.caption)} under a frame captioned ${JSON.stringify(frame.caption)}`,
  );
}

/**
 * The three channels an array frame can carry beyond boxes and digits: the
 * magnitude bars, the swap arcs, and the region bracket.
 *
 * Each is checked against the trace that asked for it, at the address it asked
 * for, because each one makes a claim a student will believe. A bar says "this
 * value is bigger than that one" and is a lie if its height is not
 * proportional; an arc says "these two exchanged" and is a lie if it lands on
 * the wrong pair; a bracket says "this run is settled" and is a lie if it
 * spans the wrong cells.
 */
function checkArrayChannels(
  familyId: string,
  traceFrame: TraceFrame,
  frame: DsaFrameScene,
): void {
  if (traceFrame.state.kind !== "array") return;
  const state = traceFrame.state;
  const where = `${familyId}/${frame.frameId}`;
  const bounds = frame.renderScene.entityBounds;
  const primitives = frame.renderScene.primitives;
  const centreX = (id: string): number | null => {
    const box = bounds[id];
    return box ? box.x + box.width / 2 : null;
  };

  // --- Bars are exactly proportional, from one shared baseline. ---
  if (state.bars && !state.groups?.length) {
    // A zero bar is deliberately not drawn: an elevation map with an empty
    // column should read as empty rather than as a hairline rectangle. Only a
    // bar with height owes the board ink.
    const owed = state.bars.map((value, index) => ({ value, index })).filter((bar) => bar.value > 0);
    const drawn = owed.map((bar) => bounds[`bar${bar.index}`]);
    const anyDrawn = drawn.some((box) => box !== undefined);
    if (anyDrawn) {
      assert(
        drawn.every((box) => box !== undefined),
        `${where}: ${drawn.filter((box) => box === undefined).length} of ${drawn.length} bars are missing, ` +
          `so the column measures only part of the array`,
      );
      const largest = Math.max(...state.bars);
      const tallest = Math.max(...drawn.map((box) => box!.height));
      // Indexed through `owed`, because `drawn` skips the zero columns: read
      // straight off `state.bars` it would compare bar 3's box with cell 4's
      // value on any row with a gap in it.
      for (const [at, box] of drawn.entries()) {
        const bar = owed[at]!;
        const expected = (bar.value / largest) * tallest;
        assert(
          Math.abs(box!.height - expected) <= 1.5,
          `${where}: bar ${bar.index} stands ${box!.height.toFixed(1)}px for value ${bar.value} ` +
            `but proportion demands ${expected.toFixed(1)}px — the height is not the value`,
        );
      }
      // A column measured from different baselines compares nothing.
      const baselines = drawn.map((box) => box!.y + box!.height);
      const spread = Math.max(...baselines) - Math.min(...baselines);
      assert(spread <= 1, `${where}: bars sit on ${spread.toFixed(1)}px of different baselines`);
      // Taller must mean bigger, or the channel is backwards.
      for (const [a, boxA] of drawn.entries()) {
        for (const [b, boxB] of drawn.entries()) {
          if (owed[a]!.value <= owed[b]!.value) continue;
          assert(
            boxA!.height > boxB!.height - 1,
            `${where}: value ${owed[a]!.value} draws a shorter bar than value ${owed[b]!.value}`,
          );
        }
      }
    }
  }

  // --- The swap glyph lands on the pair that actually swapped. ---
  //
  // Two legs, one per direction, and they have to cross: a pair of parallel
  // arrows says "both values moved right", which is not what a swap is. The
  // first attempt here drew two semicircles about a shared centre, which
  // compiles to a plain circle under the array and shows no exchange at all,
  // so "does it look like a swap" is checked rather than "is there ink".
  const swapLegs = primitives.filter(
    (primitive) => primitive.entityId === "swap_right" || primitive.entityId === "swap_left",
  );
  if (state.swap && !state.groups?.length && state.swap.from !== state.swap.to) {
    assert(
      swapLegs.length === 2,
      `${where}: a frame that swaps ${state.swap.from} and ${state.swap.to} drew ${swapLegs.length} ` +
        `arrows, so the exchange is not on the board`,
    );
    const lowX = centreX(`cell${Math.min(state.swap.from, state.swap.to)}`);
    const highX = centreX(`cell${Math.max(state.swap.from, state.swap.to)}`);
    assert(lowX !== null && highX !== null, `${where}: swap endpoints name cells that were never drawn`);
    for (const leg of swapLegs) {
      const start = leg.points[0];
      const end = leg.points[leg.points.length - 1];
      assert(start && end, `${where}: swap arrow ${leg.entityId} has no endpoints`);
      const wantStart = leg.entityId === "swap_right" ? lowX! : highX!;
      const wantEnd = leg.entityId === "swap_right" ? highX! : lowX!;
      assert(
        Math.abs(start!.x - wantStart) <= 1.5 && Math.abs(end!.x - wantEnd) <= 1.5,
        `${where}: ${leg.entityId} runs ${start!.x.toFixed(0)} to ${end!.x.toFixed(0)} instead of ` +
          `${wantStart.toFixed(0)} to ${wantEnd.toFixed(0)}, so it connects the wrong cells`,
      );
      assert(
        Math.abs(end!.y - start!.y) > 4,
        `${where}: ${leg.entityId} is horizontal, so the two legs lie on each other instead of crossing`,
      );
    }
    const [a, b] = swapLegs;
    const sameDirection =
      Math.sign(a!.points.at(-1)!.x - a!.points[0]!.x) ===
      Math.sign(b!.points.at(-1)!.x - b!.points[0]!.x);
    assert(
      !sameDirection,
      `${where}: both swap arrows point the same way, which shows a shift rather than an exchange`,
    );
  } else {
    assert(
      swapLegs.length === 0,
      `${where}: ${swapLegs.length} swap arrow(s) drawn on a frame that swaps nothing`,
    );
  }
  assert(
    primitives.every((primitive) => primitive.kind !== "arc"),
    `${where}: an arc reached an array figure — two opposing semicircles compile to a circle, ` +
      "which reads as a ring under the row rather than as a swap",
  );

  // --- The bracket spans exactly the cells the trace claims. ---
  for (const [order, bracket] of (state.brackets ?? []).entries()) {
    if (state.groups?.length) continue;
    const box = bounds[`brk${order}`];
    assert(box, `${where}: bracket "${bracket.label}" produced no ink, so the region is invisible`);
    const first = bounds[`cell${Math.min(bracket.from, bracket.to)}`];
    const last = bounds[`cell${Math.max(bracket.from, bracket.to)}`];
    assert(first && last, `${where}: bracket "${bracket.label}" names cells that were never drawn`);
    assert(
      Math.abs(box!.x - first!.x) <= 2 && Math.abs((box!.x + box!.width) - (last!.x + last!.width)) <= 2,
      `${where}: bracket "${bracket.label}" spans ${box!.x.toFixed(0)} to ${(box!.x + box!.width).toFixed(0)} ` +
        `but cells ${bracket.from} to ${bracket.to} span ${first!.x.toFixed(0)} to ${(last!.x + last!.width).toFixed(0)}`,
    );
    const drawnLabel = primitives.find(
      (primitive) => primitive.kind === "label" && primitive.entityId === `brk${order}_lbl`,
    );
    assert(
      (drawnLabel as { text?: string } | undefined)?.text === bracket.label,
      `${where}: bracket ${order} is labelled ${JSON.stringify((drawnLabel as { text?: string } | undefined)?.text)} ` +
        `instead of ${JSON.stringify(bracket.label)}`,
    );
  }
}

console.log(
  `verify-dsa-trace-render: ${ALGORITHM_FAMILIES.length} families, ${frameCount} frames, all checks passed` +
    (renderDir ? ` (SVGs in ${renderDir})` : ""),
);
