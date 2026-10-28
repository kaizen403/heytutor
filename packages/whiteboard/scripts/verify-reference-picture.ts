/**
 * Reference pictures on the board: a stored picture is laid on a paper card,
 * traced by the pencil along its outline strokes, swept in along its fill
 * strokes, and credited under the card.
 *
 * What has to hold, and what each group below proves:
 *   - a seek or restore (duration 0) lands the finished picture at once: card,
 *     picture and credit, under any later ink;
 *   - a watched pass is drawn by the pencil, card first, visiting the plan's
 *     strokes in the plan's order, painting through the right source;
 *   - a cancelled, rolled back or aborted pass leaves nothing behind;
 *   - CLEAR, an animated clear and an erase take card, picture and credit away
 *     together, never one without the others;
 *   - a numbered picture's key is written by the pen beside the card, inside
 *     the zone and clear of the picture, lands at once on a seek, and goes
 *     with the picture on CLEAR, an erase, a cancel or a rollback;
 *   - only a well-formed picture command for a picture id passes the ownership
 *     check, and the teaching stream cannot emit one at all;
 *   - a pass's time stays inside its documented floor and cap, and the turn's
 *     schedule (tutor-core) and the board agree on it;
 *   - canvas memory stays flat (iOS Safari blanks a board past its canvas cap):
 *     50 seeks build a picture's line work once, every canvas a pass makes is
 *     zeroed when it lands or when CLEAR, an erase, a rollback or an abort
 *     takes it away, and the asset cache stays bounded without breaking a
 *     picture still on the board, and revokes every blob URL it made.
 *
 * Run: npx tsx --tsconfig ../../apps/tutor/tsconfig.json scripts/verify-reference-picture.ts
 * (the tsconfig maps @heytutor/drawing to source when no dist is built).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Konva from "konva";
import ts from "typescript";
import * as drawing from "@heytutor/drawing";
import {
  DRAW_COMMAND_TYPES,
  REFERENCE_PICTURE_CREDIT_Y,
  REFERENCE_PICTURE_ZONE,
  fitPicture,
  isBlockedVerifiedDiagramCommand,
  parseDrawingCommands,
  referencePictureCommands,
  referencePictureCredit,
  referencePictureLayout,
  type DrawCommand,
  type ReferencePictureLegendEntry,
  type ReferencePictureRecord,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import { admitReferencePictureCommand } from "../../drawing/src/protocol/commandPlacement";
import {
  REFERENCE_PICTURE_PASS_MS,
  getDrawingDuration,
  getFlightDuration,
  referencePicturePassMs,
} from "../../tutor-core/src/sync/audioSync";
import { cuedInkCapMs, cuedInkFloorMs, estimateCommandInkLengthPx } from "../../tutor-core/src/sync/cueWindow";
import {
  PICTURE_CARD_FADE_MS,
  PICTURE_PASS_MS,
  boardPictureStrokes,
  pictureFrameAt,
  pictureRevealSpans,
  planPictureTimeline,
  resolvePicturePassMs,
} from "../src/pictureReveal";
import { INK_SPEED_PX_PER_MS } from "../src/penMotion";
import * as pictureCanvases from "../src/pictureCanvases";
import { BLEND_PAPER_MIN_LUMA, boardPictureDrawable, keyPaperToAlpha, paperBlends } from "../src/pictureCanvases";
import type { BoardPicture, WhiteboardHandle } from "../src/Whiteboard";
import { createVirtualWhiteboardClock } from "../src/whiteboardClock";
import { getTestWhiteboardRefs, mountTestWhiteboard, unmountTestWhiteboard } from "./whiteboardTestHarness";
import { runWhiteboardVerifier } from "./runWhiteboardVerifier";

const PICTURE_ID = "rp_0123456789abcdef01234567";
const PLAN_WIDTH = 400;
const PLAN_HEIGHT = 300;
const OUTLINE_STROKES = [
  [20, 20, 120, 20, 120, 80],
  [200, 40, 260, 40],
  [300, 200, 300, 260, 360, 260],
];
const FILL_STROKES = [0, 1, 2, 3, 4, 5].map((lane) => {
  const x = 36 + lane * 66;
  return lane % 2 === 0 ? [x, 0, x, PLAN_HEIGHT] : [x, PLAN_HEIGHT, x, 0];
});
const lengthOf = (strokes: number[][]) => strokes.reduce((sum, stroke) => {
  let length = 0;
  for (let i = 2; i + 1 < stroke.length; i += 2) length += Math.hypot(stroke[i]! - stroke[i - 2]!, stroke[i + 1]! - stroke[i - 1]!);
  return sum + length;
}, 0);
const RECORD: ReferencePictureRecord = {
  id: PICTURE_ID,
  source: "wikimedia",
  title: "File:Synthetic diagram.svg",
  pageUrl: "https://commons.wikimedia.org/wiki/File:Synthetic_diagram.svg",
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
  artist: "Test Artist",
  imageUrl: `/api/reference-picture/${PICTURE_ID}/image`,
  planUrl: `/api/reference-picture/${PICTURE_ID}/plan`,
  width: 800,
  height: 600,
  shows: "a synthetic diagram",
  labels: [],
  plan: { width: PLAN_WIDTH, height: PLAN_HEIGHT, outlineLengthPx: lengthOf(OUTLINE_STROKES), fillLengthPx: lengthOf(FILL_STROKES) },
};
const PLACEMENT = fitPicture(PLAN_WIDTH, PLAN_HEIGHT, REFERENCE_PICTURE_ZONE);
const SCALE = PLACEMENT.width / PLAN_WIDTH;
const KEY: ReferencePictureLegendEntry[] = ["Right atrium", "Left atrium", "Superior vena cava", "Aorta", "Pulmonary artery", "Atrioventricular (tricuspid) valve"]
  .map((label, i) => ({ mark: String(i + 1), label }));
const KEYED_LAYOUT = referencePictureLayout({ plan: { width: PLAN_WIDTH, height: PLAN_HEIGHT }, legend: KEY })!;
const KEYED_PLACEMENT = KEYED_LAYOUT.picture;

/** Canvases that record what is drawn on them: the board paints nothing in Node. */
type Recorded = { canvas: HTMLCanvasElement; calls: Array<{ name: string; args: unknown[] }> };
const recorded: Recorded[] = [];
function installRecordingCanvas(): void {
  Konva.Util.createCanvasElement = () => {
    const calls: Recorded["calls"] = [];
    const target: Record<string, unknown> = {
      measureText: (text: string) => ({ width: text.length * 16 }),
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      createPattern: (...args: unknown[]) => { calls.push({ name: "createPattern", args }); return { pattern: args[0] }; },
    };
    const context = new Proxy(target, {
      get(object, key) {
        if (key in object) return object[key as string];
        if (String(key).includes("BackingStore")) return 1;
        return (...args: unknown[]) => { calls.push({ name: String(key), args }); };
      },
      set(object, key, value) {
        calls.push({ name: `set:${String(key)}`, args: [value] });
        object[key as string] = value;
        return true;
      },
    });
    const canvas = { style: {}, width: 0, height: 0, getContext: () => context, remove() {}, toDataURL: () => "" } as unknown as HTMLCanvasElement;
    recorded.push({ canvas, calls });
    return canvas;
  };
}
const callsOf = (canvas: unknown) => recorded.find((entry) => entry.canvas === canvas)?.calls ?? [];
/** The picture through its ink mask: the only canvas a land builds. */
const isLineWork = (canvas: unknown) => callsOf(canvas).some((call) =>
  call.name === "set:globalCompositeOperation" && call.args[0] === "destination-in");
const isZeroed = (canvas: unknown) => (canvas as HTMLCanvasElement).width === 0 && (canvas as HTMLCanvasElement).height === 0;

function makePicture(image = {} as CanvasImageSource, inkMask = {} as CanvasImageSource, legend?: ReferencePictureLegendEntry[]): BoardPicture {
  return {
    ...(legend ? { legend } : {}),
    id: PICTURE_ID,
    image,
    inkMask,
    credit: referencePictureCredit(RECORD),
    plan: {
      width: PLAN_WIDTH,
      height: PLAN_HEIGHT,
      paper: "#fdfcf7",
      outline: { brushPx: 6, strokes: OUTLINE_STROKES, lengthPx: RECORD.plan.outlineLengthPx },
      fill: { brushPx: 72, strokes: FILL_STROKES, lengthPx: RECORD.plan.fillLengthPx },
    },
  };
}

function verifyOwnership(): void {
  const [outline, fill] = referencePictureCommands(RECORD).map((command) => ({
    ...command, charPosition: 0, narrationBefore: "",
  }) as DrawCommand);
  const diagram = { id: "d", anchors: [], commands: [], layout: "standard" } as unknown as VerifiedDiagram;
  for (const command of [outline!, fill!]) {
    assert.ok(admitReferencePictureCommand(command), `${command.semanticRef?.primitiveId}: the contract's own command is admitted`);
    assert.equal(isBlockedVerifiedDiagramCommand(command, null), false, "a valid picture passes with no figure on the board");
    assert.equal(isBlockedVerifiedDiagramCommand(command, diagram), false, "and the answer does not depend on the figure");
  }
  assert.deepEqual(admitReferencePictureCommand(outline!)?.placement, PLACEMENT);
  assert.equal(admitReferencePictureCommand(fill!)?.pass, "fill");

  const variants: Array<[string, Partial<DrawCommand>]> = [
    ["no id", { text: undefined }],
    ["short id", { text: "rp_0123" }],
    ["uppercase id", { text: PICTURE_ID.toUpperCase().replace("RP_", "rp_") }],
    ["path in id", { text: "rp_../../../etc/passwd000000" }],
    ["url as id", { text: "https://example.com/x.png" }],
    ["wrong entity", { semanticRef: { entityId: "lens", primitiveId: "reference_picture.outline" } }],
    ["no entity", { semanticRef: undefined }],
    ["wrong primitive", { semanticRef: { entityId: "reference_picture", primitiveId: "reference_picture.fill" } }],
    ["left of the zone", { params: [300, 118, 640, 480, 0, 640] }],
    ["below the zone", { params: [465, 300, 640, 480, 0, 640] }],
    ["off the board", { params: [465, 118, 900, 480, 0, 640] }],
    ["unknown pass", { params: [465, 118, 640, 480, 7, 640] }],
    ["negative length", { params: [465, 118, 640, 480, 0, -1] }],
    ["too few params", { params: [465, 118, 640, 480, 0] }],
    ["not finite", { params: [465, 118, Number.NaN, 480, 0, 640] }],
    ["a smudge", { params: [600, 300, 8, 8, 0, 10] }],
  ];
  for (const [name, change] of variants) {
    const command = { ...outline!, ...change } as DrawCommand;
    assert.equal(admitReferencePictureCommand(command), null, `${name}: must not be admitted`);
    assert.equal(isBlockedVerifiedDiagramCommand(command, null), true, `${name}: must be blocked`);
    assert.equal(isBlockedVerifiedDiagramCommand(command, diagram), true, `${name}: must be blocked beside a figure too`);
  }
  // A numbered picture's three passes are all admitted; a legend pass
  // claiming to be the outline is not.
  const keyedCommands = referencePictureCommands({ ...RECORD, legend: KEY }).map((command) => ({ ...command, charPosition: 0, narrationBefore: "" }) as DrawCommand);
  assert.deepEqual(keyedCommands.map((command) => admitReferencePictureCommand(command)?.pass), ["outline", "fill", "legend"]);
  assert.ok(keyedCommands.every((command) => admitReferencePictureCommand(command)?.placement.width === KEYED_PLACEMENT.width), "every pass carries the picture's placement");
  assert.equal(admitReferencePictureCommand({ ...keyedCommands[2]!, semanticRef: { entityId: "reference_picture", primitiveId: "reference_picture.outline" } }), null);

  // Another command type borrowing the picture's id and entity is not a picture.
  assert.equal(admitReferencePictureCommand({ ...outline!, type: "DRAW_RECT" }), null);

  // The teaching stream cannot emit it: not a parseable tag type at all.
  assert.ok(!(DRAW_COMMAND_TYPES as readonly string[]).includes("DRAW_PICTURE"), "DRAW_PICTURE must stay out of DRAW_COMMAND_TYPES");
  const parsed = parseDrawingCommands(`Look at this. [DRAW_PICTURE:465,118,640,480,0,640] It shows the eye.`);
  assert.ok(parsed.commands.every((command) => command.type !== "DRAW_PICTURE"), "model text must never yield DRAW_PICTURE");

  // The executor checks it on every path, trusted envelopes included.
  const executor = readFileSync(fileURLToPath(new URL(
    "../../../apps/tutor/features/tutor-session/hooks/useCommandExecution.ts", import.meta.url)), "utf8");
  const pictureCase = executor.slice(executor.indexOf('case "DRAW_PICTURE"'), executor.indexOf('case "PAUSE"'));
  assert.match(pictureCase, /isBlockedVerifiedDiagramCommand\(command, null\)/, "the DRAW_PICTURE case re-checks admission itself");
  assert.match(pictureCase, /awaitReferencePicture\(/, "the case draws only a picture the server serves");
  assert.match(executor, /"DRAW_PICTURE",\n\]\);/, "DRAW_PICTURE is in the uncompiled structural guard");
  const trace = executor.slice(executor.indexOf("function verifiedCommandTracePath"), executor.indexOf("function anchorRingPath"));
  assert.match(trace, /case "DRAW_PICTURE"[\s\S]*PICTURE_CARD_PADDING_PX/, "a FOCUS on the picture traces its card's edge");
}

function verifyDurations(): void {
  for (const pass of ["outline", "fill"] as const) {
    const { minMs, maxMs } = PICTURE_PASS_MS[pass];
    assert.deepEqual(REFERENCE_PICTURE_PASS_MS[pass], PICTURE_PASS_MS[pass], `${pass}: tutor-core and the board share one floor and cap`);
    for (const lengthPx of [0, 50, 2_000, 8_000, 20_000, 28_000, 200_000]) {
      const natural = resolvePicturePassMs({ pass, lengthPx, requestedMs: 0 });
      assert.equal(natural, Math.round(Math.min(Math.max(lengthPx / INK_SPEED_PX_PER_MS, minMs), maxMs)),
        `${pass} ${lengthPx}px: with no request the hand speed decides, inside the range`);
      const command = { type: "DRAW_PICTURE", params: [465, 118, 640, 480, pass === "fill" ? 1 : 0, lengthPx], charPosition: 0, narrationBefore: "" } as DrawCommand;
      assert.equal(referencePicturePassMs(command), natural, `${pass} ${lengthPx}px: the turn's estimate is the board's natural`);
      assert.equal(getDrawingDuration(command, "scene"), natural, "scene pace must not squash a picture to one shape's 320 ms");
      assert.equal(getDrawingDuration(command, "follow"), natural);
      assert.equal(getFlightDuration(command, "follow"), 0, "the reach is inside the pass's own timeline");
      assert.equal(estimateCommandInkLengthPx(command), lengthPx, "ink length is the pass's board stroke length");
      assert.equal(cuedInkFloorMs(command), natural, "a cued pass is never budgeted under hand speed");
      assert.equal(cuedInkCapMs(command), maxMs);
      for (const requestedMs of [1, 50, 1_000, 5_000, 12_000, 60_000]) {
        const ms = resolvePicturePassMs({ pass, lengthPx, requestedMs });
        assert.ok(ms >= minMs && ms <= maxMs, `${pass} ${lengthPx}px asked ${requestedMs}: ${ms} outside ${minMs}..${maxMs}`);
      }
      // Any budget the cue window can hand out is drawn exactly as given.
      for (const budget of [natural, (natural + maxMs) / 2, maxMs]) {
        assert.equal(resolvePicturePassMs({ pass, lengthPx, requestedMs: budget }), Math.round(budget),
          `${pass} ${lengthPx}px: the board draws the cued budget ${budget} as given`);
      }
    }
  }
  // A legend pass: tutor-core times every pass that is not the fill by the
  // outline's range, so the board's legend range must be the same numbers.
  assert.deepEqual(PICTURE_PASS_MS.legend, REFERENCE_PICTURE_PASS_MS.outline, "the legend pass and the turn's schedule share one floor and cap");
  const keyLength = KEYED_LAYOUT.legend!.inkLengthPx;
  for (const lengthPx of [0, keyLength, 40_000]) {
    const command = { type: "DRAW_PICTURE", params: [465, 118, 640, 480, 2, lengthPx], charPosition: 0, narrationBefore: "" } as DrawCommand;
    const natural = resolvePicturePassMs({ pass: "legend", lengthPx, requestedMs: 0 });
    assert.equal(referencePicturePassMs(command), natural, `legend ${lengthPx}px: the turn's estimate is the board's natural`);
    assert.equal(cuedInkCapMs(command), PICTURE_PASS_MS.legend.maxMs);
    assert.equal(cuedInkFloorMs(command), natural);
  }

  // A spoken window inside the range is honoured when the hand can keep up.
  assert.equal(resolvePicturePassMs({ pass: "outline", lengthPx: 2_000, requestedMs: 9_000 }), 9_000);
  // Too short for the ink: stretched toward hand speed, at most 1.5x.
  assert.equal(resolvePicturePassMs({ pass: "outline", lengthPx: 20_000, requestedMs: 5_000 }), 7_500);
}

function verifyTimeline(): void {
  const picture = makePicture();
  const strokes = boardPictureStrokes(picture.plan.outline, picture.plan, PLACEMENT);
  assert.equal(strokes.length, 3);
  assert.ok(Math.abs(strokes.reduce((sum, stroke) => sum + stroke.length, 0) - RECORD.plan.outlineLengthPx * SCALE) < 1e-6);
  const timeline = planPictureTimeline({
    pass: "outline", strokes, brushPx: 6 * SCALE, from: { x: 100, y: 100 }, totalMs: 4_000, leadInMs: PICTURE_CARD_FADE_MS,
  });
  assert.equal(timeline.segments.length, 6, "a lift then a stroke, for every stroke");
  assert.ok(timeline.segments[0]!.endMs >= PICTURE_CARD_FADE_MS, "the card is down before the first line");
  let clock = 0;
  timeline.segments.forEach((segment, index) => {
    assert.equal(segment.kind, index % 2 === 0 ? "travel" : "paint");
    assert.equal(segment.stroke, Math.floor(index / 2));
    assert.ok(Math.abs(segment.startMs - clock) < 1e-6 && segment.endMs >= segment.startMs, "segments tile the pass");
    clock = segment.endMs;
  });
  assert.equal(clock, 4_000);
  // Paint time follows length: stroke 0 (160 plan px) outlasts stroke 1 (60).
  const paintMs = (i: number) => timeline.segments[i * 2 + 1]!.endMs - timeline.segments[i * 2 + 1]!.startMs;
  assert.ok(Math.abs(paintMs(0) / paintMs(1) - 160 / 60) < 1e-6, "one hand speed across the strokes of a picture");
  // Reveal spans cover each stroke exactly once, in order, across any frame split.
  let mark = { stroke: 0, arcPx: 0 };
  const covered = strokes.map(() => 0);
  let segmentHint = 0;
  for (let ms = 0; ms <= 4_100; ms += 37) {
    const frame = pictureFrameAt(timeline, ms, segmentHint);
    segmentHint = frame.segment;
    for (const span of pictureRevealSpans(strokes, mark, frame)) {
      covered[span.stroke]! += span.toArcPx - span.fromArcPx;
      assert.ok(span.fromArcPx <= span.toArcPx);
    }
    mark = frame;
  }
  covered.forEach((length, i) => assert.ok(Math.abs(length - strokes[i]!.length) < 1e-6, `stroke ${i} revealed exactly once`));
  const end = pictureFrameAt(timeline, 4_000);
  assert.deepEqual(end.nib, { x: strokes[2]!.points[4]!, y: strokes[2]!.points[5]! }, "the pencil parks on the last point");
}

const pictureNodes = (board: WhiteboardHandle) => board.getDrawLayer()!.getStage()!.find(
  (node: Konva.Node) => Boolean(node.getAttr("htReferencePicture") || node.getAttr("htReferencePicturePart")),
);
const pictureGroup = (board: WhiteboardHandle) => board.getDrawLayer()!.getChildren(
  (node) => Boolean(node.getAttr("htReferencePicture")),
)[0] as Konva.Group | undefined;
const parts = (group: Konva.Group | undefined) =>
  (group?.getChildren() ?? []).map((node: Konva.Node) => node.getAttr("htReferencePicturePart") as string);

/** A mounted board on a virtual clock, painting into recording canvases. */
function driveBoard() {
  const board = mountTestWhiteboard();
  installRecordingCanvas();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  const step = async (onFrame?: () => void) => { clock.advance(16); clock.pump(); await flush(); onFrame?.(); };
  const run = async (job: Promise<void>, onFrame?: () => void, limitMs = 30_000): Promise<number> => {
    let done = false;
    void job.then(() => { done = true; });
    const startedAt = clock.now();
    await flush();
    while (!done && clock.now() - startedAt < limitMs) await step(onFrame);
    assert.ok(done, "a picture pass must finish");
    await job;
    return clock.now() - startedAt;
  };
  return { board, step, run };
}

/** A light-paper picture blends into the board: its paper keys to transparent and its card draws nothing. */
async function verifyBlend(): Promise<void> {
  const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255, 220, 40, 40, 255, 250, 252, 251, 255]);
  keyPaperToAlpha(px, [255, 255, 255]);
  assert.equal(px[3], 0, "white paper keys to fully transparent");
  assert.deepEqual([...px.slice(4, 8)], [0, 0, 0, 255], "black ink stays opaque black");
  assert.ok(px[11]! > 100 && px[11]! < 160 && px[8]! < 10, "a grey antialiased edge keeps partial black cover, so it blends with no halo");
  const red = [...px.slice(12, 16)];
  const over = (c: number, a: number) => Math.round((c * a + 255 * (255 - a)) / 255);
  assert.deepEqual([over(red[0]!, red[3]!), over(red[1]!, red[3]!), over(red[2]!, red[3]!)], [220, 40, 40], "colour laid back over white gives the original");
  assert.equal(px[19], 0, "near-white paper noise keys out");
  assert.ok(BLEND_PAPER_MIN_LUMA > 150 && BLEND_PAPER_MIN_LUMA < 230, "only light paper is keyed");
  assert.ok(paperBlends("#ffffff") && paperBlends("#f4f4f2"), "white and near-white paper blend");
  for (const tinted of ["#b0d0f0", "#ffc0c0", "#ffd5ba", "#808080", "#1f2c50"]) assert.ok(!paperBlends(tinted), `tinted or dark paper ${tinted} keeps its card`);
  // A keyed picture released with nothing showing it is freed, and never drawn again.
  const keyed = Konva.Util.createCanvasElement();
  keyed.width = 40; keyed.height = 30;
  pictureCanvases.markKeyedPictureForTest(keyed);
  const released = { image: keyed, inkMask: Konva.Util.createCanvasElement() };
  assert.ok(boardPictureDrawable(released), "a live keyed picture draws");
  pictureCanvases.releaseBoardPicture(released);
  assert.equal(keyed.width, 0, "releasing a keyed picture nothing shows frees its canvas");
  assert.ok(!boardPictureDrawable(released), "a freed keyed picture is never drawn");

  const { board, run } = driveBoard();
  const picture: BoardPicture = { ...makePicture(Konva.Util.createCanvasElement(), Konva.Util.createCanvasElement()), blended: true };
  await run(board.drawPicture(picture, PLACEMENT, "outline", 0));
  await run(board.drawPicture(picture, PLACEMENT, "fill", 0));
  const group = pictureGroup(board);
  assert.deepEqual(parts(group), ["card", "outline", "fill", "credit"], "a blended picture lands the same parts");
  const card = group!.getChildren()[0] as Konva.Rect;
  assert.equal(card.fill(), "rgba(0,0,0,0)", "a blended picture's card draws no paper");
  assert.ok(!card.shadowColor() && !card.hasShadow(), "and casts no shadow");
  assert.ok(card.x() < PLACEMENT.x && card.x() + card.width() > PLACEMENT.x + PLACEMENT.width, "the card still frames the picture for erase and FOCUS");
  const drawnBy = (node: Konva.Node): number => {
    let images = 0;
    const context = new Proxy({}, { get: (_t, key) => (key === "drawImage" ? () => { images++; } : () => {}) });
    (node as Konva.Shape).getSceneFunc().call(node, context as unknown as Konva.Context, node as Konva.Shape);
    return images;
  };
  const [, outlineNode, fillNode] = group!.getChildren();
  assert.equal(drawnBy(fillNode!), 1, "the landed fill draws the picture");
  assert.equal(drawnBy(outlineNode!), 0, "the outline under a landed blended fill draws nothing, so part transparent edges are not doubled");
  fillNode!.remove();
  assert.equal(drawnBy(outlineNode!), 1, "with no fill beside it the outline draws again (rollback keeps the lines)");
  group!.add(fillNode as Konva.Shape);
}

async function verifyBoard(): Promise<void> {
  const { board, step, run } = driveBoard();
  const instrumentRef = getTestWhiteboardRefs(board).find((ref) => ref.current === "pen");
  assert.ok(instrumentRef, "the board's instrument ref is visible to the gate");
  const picture = makePicture(Konva.Util.createCanvasElement(), Konva.Util.createCanvasElement());
  const cursor = board.getCursorLayer()!.getChildren()[0]!;

  // 1. Seek / restore: both passes at duration 0 land the finished picture.
  await run(board.drawShape("M 900 300 L 1000 300", 0));
  await run(board.drawPicture(picture, PLACEMENT, "outline", 0));
  await run(board.drawPicture(picture, PLACEMENT, "fill", 0));
  let group = pictureGroup(board);
  assert.ok(group, "an instant draw lays the picture's group");
  assert.deepEqual(parts(group), ["card", "outline", "fill", "credit"], "card, line work, picture and credit, in that order");
  assert.equal(group!.getZIndex(), 0, "the picture sits under ink drawn before it");
  const card = group!.getChildren()[0] as Konva.Rect;
  assert.equal(card.fill(), picture.plan.paper);
  assert.equal(card.opacity(), 1);
  assert.ok(card.x() < PLACEMENT.x && card.x() + card.width() > PLACEMENT.x + PLACEMENT.width, "the card frames the picture");
  const fillImage = group!.getChildren()[2] as Konva.Image;
  assert.equal(fillImage.image(), picture.image, "the finished fill is the picture itself");
  assert.deepEqual({ x: fillImage.x(), y: fillImage.y(), width: fillImage.width(), height: fillImage.height() }, PLACEMENT);
  const outlineSource = callsOf((group!.getChildren()[1] as Konva.Image).image());
  const draws = outlineSource.filter((call) => call.name === "drawImage" || call.name === "set:globalCompositeOperation");
  assert.deepEqual(draws.map((call) => call.args[0]),
    [picture.image, "destination-in", picture.inkMask, "source-over"], "the outline is the picture through its ink mask");
  const credit = group!.getChildren()[3] as Konva.Text;
  assert.equal(credit.text(), "Test Artist, CC BY-SA 4.0, via Wikimedia Commons");
  assert.ok(credit.y() + credit.fontSize() <= REFERENCE_PICTURE_CREDIT_Y + 0.01 && credit.y() >= card.y() + card.height(), "the credit sits under the card");
  assert.equal(group!.getAttr("htInk"), "scene");
  assert.equal(instrumentRef!.current, "pencil", "even an instant picture is the pencil's");
  await run(board.drawShape("M 900 320 L 1000 320", 0));
  assert.ok(board.getDrawLayer()!.getChildren().at(-1)!.getZIndex() > group!.getZIndex(), "later ink sits on top of the picture");

  // 2. CLEAR takes all of it.
  await board.clearBoard();
  assert.equal(pictureNodes(board).length, 0, "CLEAR removes card, picture and credit");

  // 3. An animated clear and an erase take it whole, never in pieces.
  await run(board.drawPicture(picture, PLACEMENT, "outline", 0));
  await run(board.drawPicture(picture, PLACEMENT, "fill", 0));
  await run(board.clearBoard(1_200), () => {
    const count = pictureNodes(board).length;
    assert.ok(count === 0 || count === 5, `a sweep must not split the picture (saw ${count} nodes)`);
  });
  assert.equal(pictureNodes(board).length, 0);
  await run(board.drawPicture(picture, PLACEMENT, "outline", 0));
  await run(board.drawPicture(picture, PLACEMENT, "fill", 0));
  await run(board.eraseRegion(1_000, 400, 150, 150, 0));
  assert.equal(pictureNodes(board).length, 0, "an erase touching the picture removes all of it");

  // 4. A watched outline: card first, the pencil, the plan's strokes in order.
  await board.clearBoard();
  await run(board.setInstrument("pen"));
  board.setCursorPos(100, 100);
  const boardStrokes = boardPictureStrokes(picture.plan.outline, picture.plan, PLACEMENT);
  const visits: number[] = [];
  let reveal: unknown = null;
  let revealWidth = 0;
  let cardOpacityAtFirstPaint: number | null = null;
  let heldPencil = true;
  let outlineSwapMs = 0;
  const outlineJob = board.drawPicture(picture, PLACEMENT, "outline", 1);
  const outlineMs = await run(outlineJob, () => {
    const revealNode = board.getAnimLayer()!.getChildren((node) => node.getAttr("htReferencePicturePart") === "outline")[0] as Konva.Image | undefined;
    if (!revealNode) { outlineSwapMs += 16; return; }
    reveal = revealNode.image();
    revealWidth = (reveal as HTMLCanvasElement).width;
    heldPencil &&= instrumentRef!.current === "pencil";
    if (cardOpacityAtFirstPaint === null && callsOf(reveal).some((call) => call.name === "stroke")) {
      cardOpacityAtFirstPaint = (pictureGroup(board)!.getChildren()[0] as Konva.Rect).opacity();
    }
    const nib = { x: cursor.x(), y: cursor.y() };
    const onStroke = boardStrokes.findIndex((stroke) => {
      for (let i = 0; i < stroke.points.length; i += 2) {
        if (Math.hypot(stroke.points[i]! - nib.x, stroke.points[i + 1]! - nib.y) < 1.5) return true;
      }
      for (let i = 2; i + 1 < stroke.points.length; i += 2) {
        const [ax, ay, bx, by] = [stroke.points[i - 2]!, stroke.points[i - 1]!, stroke.points[i]!, stroke.points[i + 1]!];
        const t = Math.max(0, Math.min(1, ((nib.x - ax) * (bx - ax) + (nib.y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
        if (Math.hypot(ax + (bx - ax) * t - nib.x, ay + (by - ay) * t - nib.y) < 1.5) return true;
      }
      return false;
    });
    if (onStroke >= 0 && visits.at(-1) !== onStroke) visits.push(onStroke);
  });
  assert.deepEqual(visits, [0, 1, 2], "the pencil follows the outline strokes in the plan's order");
  assert.ok(heldPencil, "the outline is traced with the pencil");
  assert.ok(cardOpacityAtFirstPaint !== null && cardOpacityAtFirstPaint > 0.99, `the card is down before the first line (opacity ${cardOpacityAtFirstPaint})`);
  const revealCalls = callsOf(reveal);
  const pattern = revealCalls.find((call) => call.name === "createPattern");
  assert.ok(pattern, "the brush paints with a pattern of the source");
  const strokeStarts = revealCalls.filter((call) => call.name === "moveTo").map((call) => call.args as number[]);
  const kx = revealWidth / PLACEMENT.width;
  const firstMoves: number[] = [];
  for (const [x, y] of strokeStarts) {
    const index = boardStrokes.findIndex((stroke) =>
      Math.hypot((stroke.points[0]! - PLACEMENT.x) * kx - x!, (stroke.points[1]! - PLACEMENT.y) * kx - y!) < 1e-6);
    if (index >= 0 && !firstMoves.includes(index)) firstMoves.push(index);
  }
  assert.deepEqual(firstMoves, [0, 1, 2], "each stroke is revealed from its own start, in order");
  const brush = revealCalls.find((call) => call.name === "set:lineWidth")?.args[0];
  assert.equal(brush, 6 * SCALE * kx, "the brush is the plan's brush on the board");
  const landedOutline = (pictureGroup(board)!.getChildren()[1] as Konva.Image).image() as HTMLCanvasElement;
  assert.ok(landedOutline !== reveal && isLineWork(landedOutline) && landedOutline.width === revealWidth,
    "the finished outline is the exact masked picture, not the brush's approximation");
  assert.ok(isZeroed(reveal), "landing frees the reveal the pencil painted into");
  const outlineBudget = resolvePicturePassMs({ pass: "outline", lengthPx: RECORD.plan.outlineLengthPx * SCALE, requestedMs: 1 });
  assert.equal(outlineBudget, PICTURE_PASS_MS.outline.minMs, "a sparse outline is held to its floor");
  const drawnMs = outlineMs - outlineSwapMs;
  assert.ok(drawnMs >= outlineBudget - 16 && drawnMs <= outlineBudget + 48, `the outline took ${drawnMs} ms, budget ${outlineBudget}`);
  group = pictureGroup(board);
  assert.deepEqual(parts(group), ["card", "outline"], "after the outline pass: the card and the line work, no credit yet");
  assert.equal(board.getAnimLayer()!.getChildren((node) => Boolean(node.getAttr("htReferencePicturePart"))).length, 0,
    "the reveal leaves the anim layer when it lands");

  // 5. A watched fill: the same card, no swap, the picture and its credit.
  let fillSwap = false;
  const fillMs = await run(board.drawPicture(picture, PLACEMENT, "fill", 1), () => {
    fillSwap ||= instrumentRef!.current !== "pencil";
  });
  assert.ok(!fillSwap, "the fill keeps the pencil already in hand");
  assert.equal(pictureGroup(board), group, "the fill lands on the card the outline laid");
  assert.deepEqual(parts(group), ["card", "outline", "fill", "credit"]);
  assert.equal((group!.getChildren()[2] as Konva.Image).image(), picture.image, "the finished fill is the picture itself");
  assert.ok(fillMs >= PICTURE_PASS_MS.fill.minMs - 16 && fillMs <= PICTURE_PASS_MS.fill.maxMs + 48, `fill took ${fillMs} ms`);
  assert.ok(Math.hypot(cursor.x() - (PLACEMENT.x + FILL_STROKES[5]![2]! * SCALE), cursor.y() - (PLACEMENT.y + FILL_STROKES[5]![3]! * SCALE)) < 1e-6,
    "the pencil parks on the last sweep's end");

  // 6. Cancel, rollback and abort leave nothing.
  await board.clearBoard();
  let cancelled = false;
  const cancelledJob = board.drawPicture(picture, PLACEMENT, "outline", 1, { shouldCancel: () => cancelled });
  for (let i = 0; i < 60; i++) await step();
  assert.ok(pictureNodes(board).length > 0, "the outline is under way before it is cancelled");
  cancelled = true;
  await run(cancelledJob);
  assert.equal(pictureNodes(board).length, 0, "a cancelled pass takes its card and its reveal with it");

  const transaction = board.beginDrawTransaction();
  const savepoint = board.createDrawSavepoint(transaction);
  const beat = board.drawPicture(picture, PLACEMENT, "outline", 1);
  for (let i = 0; i < 80; i++) await step();
  board.cancelDrawSavepoint(transaction, savepoint);
  await run(beat);
  board.rollbackDrawSavepoint(transaction, savepoint);
  assert.equal(pictureNodes(board).length, 0, "a rolled back beat leaves no card, reveal or picture");
  await run(board.drawPicture(picture, PLACEMENT, "outline", 0));
  await run(board.drawPicture(picture, PLACEMENT, "fill", 0));
  assert.equal(pictureNodes(board).length, 5);
  board.abortDrawTransaction(transaction);
  board.finishAbortedDrawTransaction(transaction);
  assert.equal(pictureNodes(board).length, 0, "an aborted intro takes the whole picture");

  // A fill whose outline was committed elsewhere rolls back alone.
  await run(board.drawPicture(picture, PLACEMENT, "outline", 0));
  const fillTransaction = board.beginDrawTransaction();
  const fillSavepoint = board.createDrawSavepoint(fillTransaction);
  await run(board.drawPicture(picture, PLACEMENT, "fill", 0));
  board.rollbackDrawSavepoint(fillTransaction, fillSavepoint);
  assert.deepEqual(parts(pictureGroup(board)), ["card", "outline"], "rolling back the fill keeps the outline it was drawn on");
  board.commitDrawTransaction(fillTransaction);

  unmountTestWhiteboard(board);
}

/** A legend group's glyph strokes, and the key's block in board px. */
const legendOf = (board: WhiteboardHandle) => pictureGroup(board)?.getChildren((node) => node.getAttr("htReferencePicturePart") === "legend")[0] as Konva.Group | undefined;
const glyphs = (legend: Konva.Group | undefined) => (legend?.getChildren() ?? []) as Konva.Shape[];
/** Shown, and not held back by a reveal dash. */
const isWritten = (node: Konva.Shape) => node.visible() && !(node instanceof Konva.Path && node.dashEnabled() && (node.dash()?.length ?? 0) > 0);

async function verifyLegend(): Promise<void> {
  const { board, step, run } = driveBoard();
  const instrumentRef = getTestWhiteboardRefs(board).find((ref) => ref.current === "pen");
  assert.ok(instrumentRef);
  const keyed = makePicture(Konva.Util.createCanvasElement(), Konva.Util.createCanvasElement(), KEY);
  const key = KEYED_LAYOUT.legend!;
  const zone = REFERENCE_PICTURE_ZONE;
  const cursor = board.getCursorLayer()!.getChildren()[0]!;
  const landAll = async (duration: number) => {
    for (const pass of ["outline", "fill", "legend"] as const) await run(board.drawPicture(keyed, KEYED_PLACEMENT, pass, duration));
  };

  // 1. Seek / restore: the key lands at once, in the picture's group, in pen.
  const canvasesBefore = recorded.length;
  await landAll(0);
  const group = pictureGroup(board);
  assert.deepEqual(parts(group), ["card", "outline", "fill", "credit", "legend"], "the key lands last, inside the picture's group");
  const legend = legendOf(board)!;
  assert.ok(glyphs(legend).length >= KEY.map((entry) => entry.mark + entry.label).join("").replace(/\s+/g, "").length, "every character of the key is written");
  assert.ok(glyphs(legend).every(isWritten), "an instant key is fully written");
  assert.equal(instrumentRef!.current, "pen", "the key is words: the pen writes it");
  const box = legend.getClientRect({ skipShadow: true, skipStroke: true });
  assert.ok(box.x >= key.x - 2 && box.y >= key.y - 2 && box.x + box.width <= key.x + key.width + 2 && box.y + box.height <= key.y + key.height + 8,
    `the key's ink stays in its block (${JSON.stringify(box)} vs ${JSON.stringify({ x: key.x, y: key.y, width: key.width, height: key.height })})`);
  assert.ok(box.x >= zone.x && box.x + box.width <= zone.x + zone.width && box.y >= zone.y && box.y + box.height <= zone.y + zone.height + 8, "the key stays inside the zone");
  assert.ok(box.x > KEYED_PLACEMENT.x + KEYED_PLACEMENT.width + 6, "the key never touches the card");
  assert.equal(recorded.length, canvasesBefore + recorded.slice(canvasesBefore).filter((entry) => isLineWork(entry.canvas)).length, "the key makes no canvas of its own");
  await run(board.drawPicture(keyed, KEYED_PLACEMENT, "legend", 0));
  assert.equal(parts(pictureGroup(board)).filter((part) => part === "legend").length, 1, "a re-land adds no second key");

  // 2. CLEAR and an erase take the key with the picture.
  await board.clearBoard();
  assert.equal(pictureNodes(board).length, 0, "CLEAR removes the key with the picture");
  await landAll(0);
  await run(board.eraseRegion(key.x + 4, key.y + 4, 40, 40, 0));
  assert.equal(pictureNodes(board).length, 0, "an erase touching the key removes the whole picture");
  await landAll(0);
  await run(board.eraseRegion(KEYED_PLACEMENT.x + 4, KEYED_PLACEMENT.y + 4, 40, 40, 0));
  assert.equal(pictureNodes(board).length, 0, "an erase touching the picture removes its key too");

  // 3. A watched key: the pen, row by row, inside the block, on its budget.
  await board.clearBoard();
  await run(board.drawPicture(keyed, KEYED_PLACEMENT, "outline", 0));
  await run(board.drawPicture(keyed, KEYED_PLACEMENT, "fill", 0));
  assert.equal(instrumentRef!.current, "pencil");
  let wrotePen = true;
  let sawPartial = false;
  let nibOutside = 0;
  let arrived = false;
  let swapMs = 0;
  let firstNibY = Number.POSITIVE_INFINITY;
  let lastNibY = Number.NEGATIVE_INFINITY;
  const watched = board.drawPicture(keyed, KEYED_PLACEMENT, "legend", 1);
  const watchedMs = await run(watched, () => {
    const writing = board.getAnimLayer()!.getChildren((node) => node.getAttr("htReferencePicturePart") === "legend")[0] as Konva.Group | undefined;
    if (!writing) { swapMs += 16; return; }
    wrotePen &&= instrumentRef!.current === "pen";
    const shown = glyphs(writing).filter((node) => node instanceof Konva.Path && (!node.dashEnabled() || (node.dashOffset() ?? 0) < (node.dash()?.[0] ?? 0) - 0.01)).length;
    if (shown > 0 && shown < glyphs(writing).length) sawPartial = true;
    const nib = { x: cursor.x(), y: cursor.y() };
    const away = nib.x < key.x - 30 || nib.x > key.x + key.width + 30 || nib.y < key.y - 30 || nib.y > key.y + key.height + 30;
    // The reach from the fill's last sweep is a flight; after it the pen stays on the key.
    if (!away) { arrived = true; firstNibY = Math.min(firstNibY, nib.y); lastNibY = Math.max(lastNibY, nib.y); }
    else if (arrived) nibOutside++;
  });
  assert.ok(wrotePen, "the pen, not the pencil, writes the key");
  assert.ok(sawPartial, "the key is written stroke by stroke, not stamped");
  assert.ok(arrived && nibOutside === 0, `the nib stays on the key once it gets there (${nibOutside} frames away)`);
  assert.ok(lastNibY - firstNibY > key.height * 0.6, "the pen works down the rows");
  const budget = resolvePicturePassMs({ pass: "legend", lengthPx: key.inkLengthPx, requestedMs: 1 });
  const drawnMs = watchedMs - swapMs;
  assert.ok(drawnMs >= budget - 16 && drawnMs <= budget + 48 && budget >= PICTURE_PASS_MS.legend.minMs && budget <= PICTURE_PASS_MS.legend.maxMs, `the key took ${drawnMs} ms, budget ${budget}`);
  assert.deepEqual(parts(pictureGroup(board)), ["card", "outline", "fill", "credit", "legend"], "the watched key lands in the picture's group");
  assert.ok(glyphs(legendOf(board)).every(isWritten), "every stroke of the landed key is written in full");
  assert.equal(board.getAnimLayer()!.getChildren((node) => Boolean(node.getAttr("htReferencePicturePart"))).length, 0, "the key leaves the anim layer when it lands");

  // 4. Cancel and rollback take the half-written key and nothing else.
  await board.clearBoard();
  await run(board.drawPicture(keyed, KEYED_PLACEMENT, "outline", 0));
  await run(board.drawPicture(keyed, KEYED_PLACEMENT, "fill", 0));
  let cancelled = false;
  const cancelledJob = board.drawPicture(keyed, KEYED_PLACEMENT, "legend", 1, { shouldCancel: () => cancelled });
  for (let i = 0; i < 80; i++) await step();
  cancelled = true;
  await run(cancelledJob);
  assert.deepEqual(parts(pictureGroup(board)), ["card", "outline", "fill", "credit"], "a cancelled key leaves the picture and no half key");
  assert.equal(board.getAnimLayer()!.getChildren((node) => Boolean(node.getAttr("htReferencePicturePart"))).length, 0);
  const transaction = board.beginDrawTransaction();
  const savepoint = board.createDrawSavepoint(transaction);
  const beat = board.drawPicture(keyed, KEYED_PLACEMENT, "legend", 1);
  for (let i = 0; i < 80; i++) await step();
  board.cancelDrawSavepoint(transaction, savepoint);
  await run(beat);
  board.rollbackDrawSavepoint(transaction, savepoint);
  assert.deepEqual(parts(pictureGroup(board)), ["card", "outline", "fill", "credit"], "a rolled back key beat keeps the picture it was written beside");
  const landed = board.createDrawSavepoint(transaction);
  await run(board.drawPicture(keyed, KEYED_PLACEMENT, "legend", 0));
  board.rollbackDrawSavepoint(transaction, landed);
  assert.deepEqual(parts(pictureGroup(board)), ["card", "outline", "fill", "credit"], "rolling back a landed key removes only the key");
  board.abortDrawTransaction(transaction);
  board.finishAbortedDrawTransaction(transaction);

  // 5. No key, or a placement the layout does not give: nothing is written.
  await board.clearBoard();
  await run(board.drawPicture(makePicture(), PLACEMENT, "outline", 0));
  await run(board.drawPicture(makePicture(), PLACEMENT, "legend", 0));
  assert.deepEqual(parts(pictureGroup(board)), ["card", "outline"], "a picture with no key writes no legend");
  await board.clearBoard();
  await run(board.drawPicture(keyed, PLACEMENT, "outline", 0));
  await run(board.drawPicture(keyed, PLACEMENT, "legend", 0));
  assert.deepEqual(parts(pictureGroup(board)), ["card", "outline"], "a key is never written beside a placement it was not laid out for");

  unmountTestWhiteboard(board);
}

const revealOnAnimLayer = (board: WhiteboardHandle) => board.getAnimLayer()!.getChildren(
  (node) => Boolean(node.getAttr("htReferencePicturePart")),
)[0] as Konva.Image | undefined;
const outlineCanvasOf = (board: WhiteboardHandle, id: string) => {
  const group = board.getDrawLayer()!.getChildren((node) => String(node.getAttr("htReferencePicture")).startsWith(`${id}@`))[0] as Konva.Group | undefined;
  const outline = group?.getChildren((node) => node.getAttr("htReferencePicturePart") === "outline")[0] as Konva.Image | undefined;
  return outline?.image() as HTMLCanvasElement | undefined;
};
/** Canvases the picture flow made since `from`: the line work, a fill's scaled source, a reveal. */
const pictureCanvasesSince = (from: number, picture: BoardPicture) => recorded.slice(from)
  .filter((entry) => entry.calls.some((call) =>
    (call.name === "drawImage" && call.args[0] === picture.image) || call.name === "createPattern"))
  .map((entry) => entry.canvas);

async function verifyCanvasMemory(): Promise<void> {
  const { board, step, run } = driveBoard();
  const land = async (picture: BoardPicture) => {
    await run(board.drawPicture(picture, PLACEMENT, "outline", 0));
    await run(board.drawPicture(picture, PLACEMENT, "fill", 0));
  };
  const untilPainting = async () => {
    for (let i = 0; i < 400 && !callsOf(revealOnAnimLayer(board)?.image()).some((call) => call.name === "stroke"); i++) await step();
    const reveal = revealOnAnimLayer(board)?.image();
    assert.ok(reveal && !isZeroed(reveal), "the pass is painting its reveal");
    return reveal as HTMLCanvasElement;
  };

  // 1. Fifty seeks, each clearing the board and re-landing both passes,
  // build the line work once and leave no other canvas live.
  const picture = makePicture(Konva.Util.createCanvasElement(), Konva.Util.createCanvasElement());
  let from = recorded.length;
  for (let seek = 0; seek < 50; seek++) {
    await board.clearBoard();
    await land(picture);
  }
  const lineWork = recorded.slice(from).map((entry) => entry.canvas).filter(isLineWork);
  assert.equal(lineWork.length, 1, `50 duration-0 lands build the masked line work once (built ${lineWork.length})`);
  assert.ok(recorded.slice(from).every((entry) => entry.canvas === lineWork[0] || isZeroed(entry.canvas)),
    "50 seeks leave no canvas live but the one shared line work");
  assert.equal(outlineCanvasOf(board, PICTURE_ID), lineWork[0], "the landed outline shows the shared line work");
  assert.ok(!isZeroed(lineWork[0]));

  // 2. Fifty re-lands on the card already down add no copies and no canvases.
  from = recorded.length;
  for (let reland = 0; reland < 50; reland++) await land(picture);
  assert.deepEqual(parts(pictureGroup(board)), ["card", "outline", "fill", "credit"], "a re-land keeps one of each part");
  assert.equal(recorded.slice(from).filter((entry) => isLineWork(entry.canvas)).length, 0, "a re-land builds nothing");
  assert.ok(pictureCanvases.boardPictureInUse(picture));

  // 3. Watched passes reuse the line work and free their own canvases on landing.
  await board.clearBoard();
  assert.ok(!pictureCanvases.boardPictureInUse(picture), "CLEAR drops every hold the picture's nodes had");
  from = recorded.length;
  await run(board.drawPicture(picture, PLACEMENT, "outline", 1));
  await run(board.drawPicture(picture, PLACEMENT, "fill", 1));
  const passMade = pictureCanvasesSince(from, picture);
  assert.equal(passMade.filter(isLineWork).length, 0, "a watched outline paints from the cached line work");
  assert.ok(passMade.length >= 3, `both reveals and the fill's source were made (${passMade.length})`);
  assert.ok(passMade.every(isZeroed), "landing frees every canvas the passes made; the card keeps only the shared line work");
  assert.equal(outlineCanvasOf(board, PICTURE_ID), lineWork[0]);

  // 4. The owner lets the picture go while it is on the board: it keeps
  // drawing until the group is destroyed, then its line work is freed.
  pictureCanvases.releaseBoardPicture(picture);
  assert.ok(!isZeroed(lineWork[0]), "releasing a picture on the board does not blank it");
  await board.clearBoard();
  assert.ok(isZeroed(lineWork[0]), "destroying the last group of a released picture zeroes its line work");
  from = recorded.length;
  await land(picture);
  await board.clearBoard();
  assert.ok(recorded.slice(from).every((entry) => isZeroed(entry.canvas)), "a released picture drawn again frees its line work when cleared");

  // 5. A keep-visible commit keeps a partial reveal; CLEAR then frees it.
  const kept = makePicture(Konva.Util.createCanvasElement(), Konva.Util.createCanvasElement());
  const transaction = board.beginDrawTransaction();
  const keptJob = board.drawPicture(kept, PLACEMENT, "outline", 1);
  const keptReveal = await untilPainting();
  board.commitDrawTransaction(transaction);
  await run(keptJob);
  assert.ok(revealOnAnimLayer(board)?.image() === keptReveal && !isZeroed(keptReveal), "a committed partial outline stays painted");
  await board.clearBoard();
  assert.ok(isZeroed(keptReveal), "CLEAR zeroes a kept partial reveal");
  assert.ok(!pictureCanvases.boardPictureInUse(kept));

  // 6. An erase under the pencil, a cancel, a rollback and an abort each
  // leave no canvas live but the cached line work.
  from = recorded.length;
  const erasedJob = board.drawPicture(kept, PLACEMENT, "outline", 1);
  const erasedReveal = await untilPainting();
  await run(board.eraseRegion(1_000, 400, 150, 150, 0));
  assert.ok(isZeroed(erasedReveal), "an erase that takes the picture zeroes the reveal at once");
  await run(erasedJob);
  assert.equal(pictureNodes(board).length, 0);

  let cancelled = false;
  const cancelledJob = board.drawPicture(kept, PLACEMENT, "fill", 1, { shouldCancel: () => cancelled });
  const cancelledReveal = await untilPainting();
  cancelled = true;
  await run(cancelledJob);
  assert.ok(isZeroed(cancelledReveal), "a cancelled fill zeroes its reveal");

  const rollback = board.beginDrawTransaction();
  const savepoint = board.createDrawSavepoint(rollback);
  const beat = board.drawPicture(kept, PLACEMENT, "outline", 1);
  const rolledReveal = await untilPainting();
  board.cancelDrawSavepoint(rollback, savepoint);
  await run(beat);
  board.rollbackDrawSavepoint(rollback, savepoint);
  assert.ok(isZeroed(rolledReveal), "a rolled back beat zeroes its reveal");
  await land(kept);
  assert.ok(pictureCanvases.boardPictureInUse(kept));
  board.abortDrawTransaction(rollback);
  board.finishAbortedDrawTransaction(rollback);
  assert.equal(pictureNodes(board).length, 0);
  assert.ok(!pictureCanvases.boardPictureInUse(kept), "an abort drops the holds of the picture it takes");
  const keptLineWork = pictureCanvasesSince(from, kept).filter((canvas) => !isZeroed(canvas));
  assert.ok(keptLineWork.length <= 1 && keptLineWork.every(isLineWork),
    `erase, cancel, rollback and abort leave only the cached line work live (${keptLineWork.length})`);
  pictureCanvases.releaseBoardPicture(kept);
  assert.ok(keptLineWork.every(isZeroed), "releasing a picture nothing shows zeroes its line work at once");

  // 7. A released picture's line work goes with its last hold, even while
  // another node (its fill) still shows the picture.
  const solo = makePicture(Konva.Util.createCanvasElement(), Konva.Util.createCanvasElement());
  const fillNode = new pictureCanvases.PictureImage({ image: undefined }).showPicture(solo, solo.image, "picture");
  const held = pictureCanvases.holdPictureLineWork(solo, 64, 48);
  pictureCanvases.releaseBoardPicture(solo);
  assert.ok(!isZeroed(held) && pictureCanvases.boardPictureInUse(solo));
  pictureCanvases.releasePictureLineWork(solo, held);
  assert.ok(isZeroed(held), "the last hold on a released picture's line work frees it");
  fillNode.destroy();
  assert.ok(!pictureCanvases.boardPictureInUse(solo));

  unmountTestWhiteboard(board);
}

type CachedAsset = { id: string; board: BoardPicture };
type AssetStore = {
  REFERENCE_PICTURE_CACHE_LIMIT: number;
  preloadReferencePicture: (id: string) => Promise<CachedAsset>;
  peekReferencePicture: (id: string) => CachedAsset | null;
};

/**
 * The tutor's asset cache, loaded so it shares this process's canvas registry
 * with the board (one module, not a second copy behind a package import).
 */
function loadAssetStore(): AssetStore {
  const file = fileURLToPath(new URL("../../../apps/tutor/features/tutor-session/lib/board/referencePictureAssets.ts", import.meta.url));
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const modules: Record<string, unknown> = { "@heytutor/drawing": drawing, "@heytutor/whiteboard": pictureCanvases };
  const mod = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier in modules) return modules[specifier];
    throw new Error(`the asset cache must not import ${specifier}`);
  }, mod, mod.exports);
  return mod.exports as unknown as AssetStore;
}

async function verifyAssetCache(): Promise<void> {
  const liveUrls = new Set<string>();
  const brokenBlobs = new WeakSet<Blob>();
  let urls = 0;
  let fetches = 0;
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  const realFetch = globalThis.fetch;
  const realImage = (globalThis as { Image?: unknown }).Image;
  const brokenId = `rp_${"f".repeat(24)}`;
  const keyedId = `rp_${"e".repeat(24)}`;
  const badKeyId = `rp_${"d".repeat(24)}`;
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:verify/${brokenBlobs.has(blob) ? "broken-" : ""}${++urls}`;
    liveUrls.add(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => { liveUrls.delete(url); };
  (globalThis as { Image?: unknown }).Image = class {
    decoding = "auto";
    src = "";
    naturalWidth = 0;
    naturalHeight = 0;
    async decode(): Promise<void> {
      if (this.src.includes("broken")) throw new Error("undecodable");
      this.naturalWidth = 800;
      this.naturalHeight = 600;
    }
  };
  const plan = {
    version: "reference-picture-plan/v1", width: PLAN_WIDTH, height: PLAN_HEIGHT, paper: "#fdfcf7", inkMask: "data:image/png;base64,AAAA",
    outline: { brushPx: 6, strokes: OUTLINE_STROKES, lengthPx: RECORD.plan.outlineLengthPx },
    fill: { brushPx: 72, strokes: FILL_STROKES, lengthPx: RECORD.plan.fillLengthPx },
  };
  globalThis.fetch = (async (input: unknown) => {
    fetches++;
    const [, id, part] = /\/api\/reference-picture\/(rp_[0-9a-f]{24})(\/plan|\/image)?$/.exec(String(input)) ?? [];
    if (!id) return { ok: false, status: 404, json: async () => ({}) };
    if (part === "/image") {
      const blob = new Blob([id === brokenId ? "broken" : "png"]);
      if (id === brokenId) brokenBlobs.add(blob);
      return { ok: true, status: 200, blob: async () => blob };
    }
    const legend = id === keyedId ? { legend: KEY } : id === badKeyId ? { legend: [{ mark: "1" }] } : {};
    return { ok: true, status: 200, json: async () => (part === "/plan" ? plan : { ...RECORD, id, ...legend }) };
  }) as typeof fetch;

  const { board, run } = driveBoard();
  try {
    const store = loadAssetStore();
    const limit = store.REFERENCE_PICTURE_CACHE_LIMIT;
    const ids = Array.from({ length: limit * 3 }, (_, i) => `rp_${(i + 1).toString(16).padStart(24, "0")}`);
    const cached = () => ids.filter((id) => store.peekReferencePicture(id)).length;
    const land = async (asset: CachedAsset) => {
      await run(board.drawPicture(asset.board, PLACEMENT, "outline", 0));
      await run(board.drawPicture(asset.board, PLACEMENT, "fill", 0));
    };
    const preload = async (id: string) => {
      const asset = await store.preloadReferencePicture(id);
      assert.ok(cached() <= limit, `the asset cache holds at most ${limit} pictures (holds ${cached()})`);
      assert.equal(liveUrls.size, 0, "every blob URL is revoked once its picture is decoded");
      return asset;
    };

    // One picture landed then cleared (idle), one left on the board (live).
    const idle = await preload(ids[0]!);
    await land(idle);
    const idleLineWork = outlineCanvasOf(board, ids[0]!)!;
    await board.clearBoard();
    const live = await preload(ids[1]!);
    await land(live);
    const liveLineWork = outlineCanvasOf(board, ids[1]!)!;
    let next = 2;
    while (next < limit + 4) await preload(ids[next++]!);
    assert.equal(cached(), limit);
    assert.equal(store.peekReferencePicture(ids[0]!), null, "the oldest picture the board does not show is evicted first");
    assert.ok(isZeroed(idleLineWork), "evicting a picture frees the line work it left cached");
    assert.ok(store.peekReferencePicture(ids[1]!) === live, "a picture on the board is passed over by eviction");
    assert.ok(!isZeroed(liveLineWork) && outlineCanvasOf(board, ids[1]!) === liveLineWork, "and keeps drawing");
    const fetchesBefore = fetches;
    assert.equal(await store.preloadReferencePicture(ids[1]!), live, "a cached picture is not fetched again");
    assert.equal(fetches, fetchesBefore);

    // Every cached picture on the board: eviction still bounds the cache, and
    // the evicted picture keeps drawing until its group goes.
    const onBoard = ids.slice(0, next).map((id) => store.peekReferencePicture(id)).filter((asset): asset is CachedAsset => Boolean(asset));
    for (const asset of onBoard) if (asset !== live) await land(asset);
    const lineWorkOnBoard = new Map(onBoard.map((asset) => [asset.id, outlineCanvasOf(board, asset.id)!]));
    await preload(ids[next++]!);
    const evicted = onBoard.filter((asset) => !store.peekReferencePicture(asset.id));
    assert.equal(evicted.length, 1, "a full cache of pictures on the board still evicts one");
    assert.ok(!isZeroed(lineWorkOnBoard.get(evicted[0]!.id)) && outlineCanvasOf(board, evicted[0]!.id) === lineWorkOnBoard.get(evicted[0]!.id),
      "a picture evicted while on the board is not blanked");
    await board.clearBoard();
    assert.ok(isZeroed(lineWorkOnBoard.get(evicted[0]!.id)), "its line work is freed once its group is destroyed");
    assert.ok(onBoard.filter((asset) => asset !== evicted[0]).every((asset) => !isZeroed(lineWorkOnBoard.get(asset.id))),
      "pictures still cached keep their line work for the next seek");

    // A long session: the cache never grows past the limit.
    while (next < ids.length) await preload(ids[next++]!);
    assert.equal(cached(), limit);

    // A numbered picture's key reaches the board; a malformed key is no picture.
    const keyedAsset = await store.preloadReferencePicture(keyedId);
    assert.deepEqual(keyedAsset.board.legend, KEY, "the record's key reaches the board");
    assert.equal(store.peekReferencePicture(ids[0]!)?.board.legend ?? (await store.preloadReferencePicture(ids[0]!)).board.legend, undefined, "a named picture carries no key");
    await assert.rejects(store.preloadReferencePicture(badKeyId), "a record whose key is malformed does not load");

    // A picture that will not decode still revokes its URL.
    await assert.rejects(store.preloadReferencePicture(brokenId));
    assert.equal(liveUrls.size, 0, "a failed decode revokes its blob URL");
    assert.ok(urls >= ids.length + 1, "every picture went through a blob URL");
  } finally {
    unmountTestWhiteboard(board);
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    globalThis.fetch = realFetch;
    (globalThis as { Image?: unknown }).Image = realImage;
  }
}

runWhiteboardVerifier(async () => {
  verifyOwnership();
  verifyDurations();
  verifyTimeline();
  await verifyBoard();
  await verifyBlend();
  await verifyLegend();
  await verifyCanvasMemory();
  await verifyAssetCache();
  console.log(
    "verify-reference-picture: seeks land card, picture and credit; the pencil traces the outline in the plan's order " +
      "on a card already down; cancel, rollback, abort, clear and erase leave nothing or everything; 50 seeks build the " +
      "line work once and every pass canvas is zeroed when it lands or is taken away; the asset cache stays bounded, " +
      "spares pictures on the board and revokes its blob URLs; a numbered picture's key is written by the pen beside the card, " +
      "lands on a seek and goes with the picture on clear, erase, cancel and rollback; only a well-formed " +
      `picture command passes; passes stay inside outline ${PICTURE_PASS_MS.outline.minMs}..${PICTURE_PASS_MS.outline.maxMs} ms ` +
      `and fill ${PICTURE_PASS_MS.fill.minMs}..${PICTURE_PASS_MS.fill.maxMs} ms`,
  );
});
