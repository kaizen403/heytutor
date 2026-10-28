/** Executor-level FOCUS regressions: real Whiteboard, Konva nodes and VirtualCursor. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import type Konva from "konva";
import {
  REFERENCE_PICTURE_ZONE,
  rectPath,
  referencePictureLayout,
  referencePictureLegendEntryRect,
  referencePicturePartBoardRect,
  type DrawCommand,
  type ReferencePictureRecord,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import { PICTURE_CARD_PADDING_PX } from "@heytutor/whiteboard";
import { pictureFocusHole, pictureTextRingPath } from "../../features/tutor-session/lib/board/pictureFocus";
import { buildReferencePicturePresentation } from "../../features/tutor-session/lib/scene/referencePicturePresentation";
import { clearSpotlight, type SpotlightSpec } from "../../features/tutor-session/lib/board/spotlight";
import type { useCommandExecution as CommandHook } from "../../features/tutor-session/hooks/useCommandExecution";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";

// Only React reconciliation is replaced. Load the actual production executor,
// including its forwarding adapters; its board methods and cursor are real.
const EXECUTOR = fileURLToPath(new URL("../../features/tutor-session/hooks/useCommandExecution.ts", import.meta.url));
function loadExecutor(text = readFileSync(EXECUTOR, "utf8")): typeof CommandHook {
  const source = EXECUTOR;
  const requireApp = createRequire(new URL("../../package.json", import.meta.url));
  const react = {
    useRef: (current: unknown) => ({ current }),
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
    useState: (value: unknown) => [value, () => {}],
  };
  const compiled = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as { useCommandExecution: typeof CommandHook } };
  new Function("require", "module", "exports", compiled)((specifier: string) =>
    specifier === "react" ? react : requireApp(specifier.startsWith(".")
      ? path.resolve(path.dirname(source), specifier) : specifier), mod, mod.exports);
  return mod.exports.useCommandExecution;
}
const hook = loadExecutor();
const ref = <T>(current: T) => ({ current });
const flush = async () => {
  for (let index = 0; index < 40; index++) await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (let index = 0; index < 40; index++) await Promise.resolve();
};
function verifiedDiagram(): VerifiedDiagram {
  return {
    id: "verified_scene", layout: "standard", name: "offline focus",
    anchors: [
      { id: "B", labels: ["B"], x: 700, y: 200, width: 80, height: 80 },
      { id: "C", labels: ["C"], x: 900, y: 300, width: 80, height: 80 },
    ],
    groups: [], reveals: [], promptAddon: "",
    commands: [
      { type: "DRAW_LINE", params: [700, 200, 780, 280], semanticRef: { entityId: "B" } },
      { type: "DRAW_LINE", params: [900, 300, 980, 380], semanticRef: { entityId: "C" } },
    ], deferredAnnotations: [],
  };
}

/**
 * A numbered picture as lane B's targets build it: the card, a printed label
 * "R1" on the drawing, and key entry 1 whose mark "3" was located on the
 * drawing and whose row sits in the key on the right. Board px.
 */
const PICTURE = { x: 430, y: 160, width: 460, height: 400 };
const PART_R1 = { x: 610.4, y: 241.2, width: 21.6, height: 13.5 };
const KEY_MARK = { x: 520, y: 470, width: 9, height: 12 };
const KEY_ROW = { x: 922, y: 300, width: 196, height: 30 };
function pictureDiagram(withParts = true): VerifiedDiagram {
  return {
    id: "reference_picture", name: "reference picture rp_000000000000000000000001",
    anchors: [
      { id: "reference_picture", labels: [], ...PICTURE },
      ...(withParts ? [
        { id: "reference_picture.part.1", labels: ["R1"], ...PART_R1 },
        { id: "reference_picture.key.1.mark", labels: [], ...KEY_MARK },
        { id: "reference_picture.key.1.row", labels: [], ...KEY_ROW },
      ] : []),
    ],
    groups: withParts
      ? [{ id: "reference_picture.key.1", entityIds: ["reference_picture.key.1.mark", "reference_picture.key.1.row"] }]
      : [],
    reveals: [], promptAddon: "",
    commands: (["outline", "fill"] as const).map((pass, index) => ({
      type: "DRAW_PICTURE" as const,
      params: [PICTURE.x, PICTURE.y, PICTURE.width, PICTURE.height, index, 900],
      text: "rp_000000000000000000000001",
      semanticRef: { entityId: "reference_picture", primitiveId: `reference_picture.${pass}` },
    })),
    deferredAnnotations: [],
  };
}

function fixture(diagram: VerifiedDiagram = verifiedDiagram(), executorHook: typeof CommandHook = hook) {
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const executor = executorHook({
    whiteboardRef: ref(board), cancelRef: ref(false), activeVerifiedDiagramRef: ref(diagram),
    fbdPhaseStartedRef: ref(false), fbdPhaseMarkedRef: ref(false),
    boardLayoutRef: ref({ rects: [], nextY: 100 }), inkPaceRef: ref("follow"),
    speedRef: ref(1), adaptiveFactorRef: ref(1), forceSequentialWorkLayoutRef: ref(false),
    turnTelemetryRef: ref(null), notesEpochsRef: ref([]), narrationSinceEpochRef: ref(""),
    raceWithCancel: async (promise) => promise,
    resolveTextPlacement: async (_command, x, y) => ({ x, y }),
    cancellableDelay: async () => {}, forgetErasedTextRects() {}, resetBoardLayout() {},
    nowMs: clock.source.now,
  });
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 16) {
      clock.advance(16); clock.pump(); await flush();
    }
  };
  const focus = (id = "B|spotlight"): DrawCommand => ({
    type: "FOCUS", params: [], text: id, semanticRef: { entityId: id },
    charPosition: 0, narrationBefore: "",
  });
  const schedule = (ids = ["B"]) => ({
    focusSchedule: {
      targets: ids.map((id, index) => ({ id, startMs: index * 1200, endMs: index * 1200 + 1000, anchor: "label" as const })),
      matchedCount: ids.length, source: "estimated" as const,
    },
    getAudioPositionMs: () => 1_000_000,
  });
  const veils = () => board.getDrawLayer()!.getStage()!.getChildren()
    .flatMap((layer) => layer.getChildren())
    .filter((node) => node.getClassName() === "Rect" && (node as Konva.Node).getAttr("fill") === "#1A1A1A");
  return { board, diagram, executor, advance, focus, schedule, veils };
}

async function cancellationFlight(mode: "unscheduled" | "code-tour" | "code-spoken-walk" | "deferred-label") {
  const f = fixture();
  if (mode.startsWith("code-")) f.diagram.layout = "code_lesson";
  if (mode === "deferred-label") f.diagram.deferredAnnotations = [{
    entityId: "B", commands: [{
      type: "LABEL", params: [720, 200, 20], text: "B", semanticRef: { entityId: "B" },
    }],
  }];
  let cancelled = false;
  let settled = false;
  const flights: Parameters<typeof f.board.flyCursorTo>[] = [];
  const nativeFly = f.board.flyCursorTo;
  f.board.flyCursorTo = (...args) => { flights.push(args); return nativeFly(...args); };
  const job = f.executor.executeCommandWithCancel(f.focus(mode === "code-spoken-walk" ? "C|spotlight" : undefined), {
    isCancelled: () => cancelled,
    ...(mode === "code-spoken-walk" ? { spokenClock: {
      narration: "B then C", estimatedTotalMs: 4000, getTimings: () => null,
      getAudioPositionMs: () => 0, getPlaybackRate: () => 1,
    } } : {}),
  }).then(() => { settled = true; });
  try {
    await flush();
    assert.equal(flights.length, 1, `${mode}: reach the actual executor flight`);
    if (mode === "deferred-label") assert.equal(flights[0]![3], -35, "lettering keeps its nib rotation");
    f.board.setPaused(true); cancelled = true;
    await f.advance(64);
    console.log(JSON.stringify({ case: mode, predicate: typeof flights[0]![4], settledWhilePaused: settled }));
    assert(settled, `${mode}: focus cancellation joins the real cursor without unpausing`);
    assert.equal(typeof flights[0]![4], "function", `${mode}: cancellation reaches Whiteboard`);
    assert.equal(f.veils().length, 0, `${mode}: cancelled focus removes its own veil`);
  } finally {
    cancelled = true; f.board.cancelAnimations(); await flush(); await job;
    unmountTestWhiteboard(f.board);
  }
}

const SUCCESSOR: SpotlightSpec = {
  veil: { x: 400, y: 100, width: 700, height: 500 },
  hole: { x: 1000, y: 400, width: 60, height: 60 }, opacity: 0.36,
};
type OwnershipCase = "successor-release" | "committed-lease" | "null-spec" | "later-retargeted-lease" | "clear-new-focus" | "code-committed-lease";
async function ownershipCase(kind: OwnershipCase) {
  const f = fixture();
  if (kind === "code-committed-lease") f.diagram.layout = "code_lesson";
  const root = kind.includes("committed") ? f.board.beginDrawTransaction() : null;
  let cancelled = false;
  let successorCancelled = false;
  let settled = false;
  let successorSettled = false;
  let successorJob = Promise.resolve();
  let raises = 0;
  const nativeSpotlight = f.board.setSpotlight;
  f.board.setSpotlight = (spec) => { if (spec) raises++; return nativeSpotlight(spec); };
  const job = f.executor.executeCommandWithCancel(
    f.focus(kind === "null-spec" ? "B|trace" : kind === "later-retargeted-lease" ? "B,C|spotlight" : undefined),
    { ...(kind === "code-committed-lease" ? {} : f.schedule(kind === "later-retargeted-lease" ? ["B", "C"] : undefined)),
      isCancelled: () => cancelled },
  ).then(() => { settled = true; });
  try {
    await flush();
    assert(!settled, "old focus is still executing on the real cursor");
    if (kind === "later-retargeted-lease") {
      for (let elapsed = 0; raises < 3 && elapsed < 3000; elapsed += 16) await f.advance(16);
      assert.equal(raises, 3, "reach the second target's own spotlight installation");
      assert(!settled, "cancel while the later target is still executing");
    }
    const old = f.veils();
    if (kind !== "null-spec") assert(old.length > 0, "old focus installs a veil");
    else assert.equal(old.length, 0, "trace focus owns no veil");
    cancelled = true;
    if (root) f.board.commitDrawTransaction(root);
    if (kind === "clear-new-focus") {
      clearSpotlight(f.board);
      assert.equal(f.veils().length, 0, "explicit teardown remains a deliberate global clear");
      successorJob = f.executor.executeCommandWithCancel(f.focus("C|spotlight"), {
        ...f.schedule(["C"]), isCancelled: () => successorCancelled,
      }).then(() => { successorSettled = true; });
      await flush();
    } else if (!root) {
      f.board.setSpotlight(SUCCESSOR);
    }
    const successor = root ? old : f.veils();
    assert(successor.length > 0, "install the veil that must survive old finally");
    if (!root) assert(!old.some((node) => successor.includes(node)), "successor has independent node identities");
    // Pump a cancelled paused flight. The successor's cursor must stay paused,
    // so the only completed command here is the stale old focus.
    f.board.setPaused(true);
    await f.advance(64);
    assert(settled, "old focus joins cancellation while paused");
    assert(!successorSettled, "successor focus remains active");
    const retained = successor.filter((node) => node.getParent() !== null).length;
    console.log(JSON.stringify({ case: kind, raises, before: successor.length, afterOldFinally: retained }));
    assert.equal(retained, successor.length, `${kind}: stale finally cannot clear successor/committed veil`);
    clearSpotlight(f.board);
    assert.equal(f.veils().length, 0, "global teardown still removes a kept veil");
  } finally {
    cancelled = true; successorCancelled = true;
    f.board.cancelAnimations(); await flush(); await job; await successorJob;
    unmountTestWhiteboard(f.board);
  }
}

type BoardEvent =
  | { kind: "fly"; x: number; y: number }
  | { kind: "trace"; mark: string; path: string }
  | { kind: "spotlight"; veil: SpotlightSpec["veil"] | null; hole: SpotlightSpec["hole"] | null };

/** Run one FOCUS to the end on the real board and log what the pen and the veil did. */
async function runFocus(
  diagram: VerifiedDiagram,
  id: string,
  scheduleIds: string[] | null,
  executorHook: typeof CommandHook = hook,
): Promise<BoardEvent[]> {
  const f = fixture(diagram, executorHook);
  const events: BoardEvent[] = [];
  const fly = f.board.flyCursorTo;
  f.board.flyCursorTo = (...args) => { events.push({ kind: "fly", x: args[0], y: args[1] }); return fly(...args); };
  const draw = f.board.drawAnnotation;
  f.board.drawAnnotation = (...args) => { events.push({ kind: "trace", mark: args[0], path: args[1] }); return draw(...args); };
  const spot = f.board.setSpotlight;
  f.board.setSpotlight = (spec) => {
    events.push({ kind: "spotlight", veil: spec?.veil ? { ...spec.veil } : null, hole: spec?.hole ? { ...spec.hole } : null });
    return spot(spec);
  };
  let settled = false;
  const job = f.executor.executeCommandWithCancel(f.focus(id), {
    ...(scheduleIds ? f.schedule(scheduleIds) : {}), isCancelled: () => false,
  }).then(() => { settled = true; });
  try {
    await flush();
    for (let elapsed = 0; !settled && elapsed < 8000; elapsed += 16) await f.advance(16);
    assert(settled, `${id}: focus finishes`);
    assert.equal(f.veils().length, 0, `${id}: the veil comes down`);
    return events;
  } finally { f.board.cancelAnimations(); await flush(); await job; unmountTestWhiteboard(f.board); }
}

/** Points along an absolute M/L/C path, a few per segment. */
function samplePath(path: string): Array<{ x: number; y: number }> {
  const tokens = path.trim().split(/\s+/);
  const points: Array<{ x: number; y: number }> = [];
  let at = { x: 0, y: 0 };
  for (let index = 0; index < tokens.length;) {
    const op = tokens[index++];
    const read = (count: number) => tokens.slice(index, index += count).map(Number);
    if (op === "M") { const [x, y] = read(2); at = { x: x!, y: y! }; points.push(at); }
    else if (op === "L") {
      const [x, y] = read(2);
      for (let t = 0.1; t <= 1.001; t += 0.1) points.push({ x: at.x + (x! - at.x) * t, y: at.y + (y! - at.y) * t });
      at = { x: x!, y: y! };
    } else if (op === "C") {
      const [x1, y1, x2, y2, x, y] = read(6);
      for (let t = 0.05; t <= 1.001; t += 0.05) {
        const u = 1 - t;
        points.push({
          x: u * u * u * at.x + 3 * u * u * t * x1! + 3 * u * t * t * x2! + t * t * t * x!,
          y: u * u * u * at.y + 3 * u * u * t * y1! + 3 * u * t * t * y2! + t * t * t * y!,
        });
      }
      at = { x: x!, y: y! };
    } else if (op === "Z") { /* closes on its start */ }
    else throw new Error(`unexpected path op ${op}`);
  }
  return points;
}

/**
 * A ring round printed text: every point clears the text box, the loop goes
 * all the way round it, and no point strays further than `hugPx` from it.
 */
function assertRingHugs(path: string, rect: { x: number; y: number; width: number; height: number }, label: string, hugPx = 14) {
  const points = samplePath(path);
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const outside = (point: { x: number; y: number }) =>
    point.x < rect.x || point.x > right || point.y < rect.y || point.y > bottom;
  const gap = (point: { x: number; y: number }) =>
    Math.hypot(Math.max(rect.x - point.x, 0, point.x - right), Math.max(rect.y - point.y, 0, point.y - bottom));
  assert(points.every(outside), `${label}: the ring never crosses the text it rings`);
  const worst = Math.max(...points.map(gap));
  assert(worst <= hugPx, `${label}: the ring stays within ${hugPx} px of the text (worst ${worst.toFixed(1)})`);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const sides = { left: false, right: false, above: false, below: false };
  for (const point of points) {
    if (point.x < rect.x && Math.abs(point.y - cy) <= rect.height / 2) sides.left = true;
    if (point.x > right && Math.abs(point.y - cy) <= rect.height / 2) sides.right = true;
    if (point.y < rect.y && Math.abs(point.x - cx) <= rect.width / 2) sides.above = true;
    if (point.y > bottom && Math.abs(point.x - cx) <= rect.width / 2) sides.below = true;
  }
  assert(Object.values(sides).every(Boolean), `${label}: the ring goes all the way round (${JSON.stringify(sides)})`);
  return worst;
}

/** Every point of the ring lies inside the spotlight hole, so none of it is dimmed. */
function assertRingInside(path: string, hole: { x: number; y: number; width: number; height: number }, label: string) {
  const out = samplePath(path).filter((point) =>
    point.x < hole.x || point.x > hole.x + hole.width || point.y < hole.y || point.y > hole.y + hole.height);
  assert.equal(out.length, 0, `${label}: the ring stays inside its spotlight hole (${out.length} points outside)`);
}

function assertSameRect(actual: { x: number; y: number; width: number; height: number } | null | undefined,
  expected: { x: number; y: number; width: number; height: number }, message: string) {
  assert(actual, message);
  for (const key of ["x", "y", "width", "height"] as const) {
    assert(Math.abs(actual[key] - expected[key]) < 1e-6, `${message} (${key} ${actual[key]} vs ${expected[key]})`);
  }
}
const zoneOf = (zone: { x: number; y: number; width: number; height: number }) =>
  ({ x: zone.x, y: zone.y, width: zone.width, height: zone.height });
const DIAGRAM_VEIL = { x: 400, y: 140, width: 760, height: 380 };

async function pictureFocusCases(): Promise<void> {
  // A printed label: one ring round "R1" under the picture zone's veil, the
  // pen landing where the ring starts, and never the card's edge.
  const part = await runFocus(pictureDiagram(), "reference_picture.part.1|spotlight", ["reference_picture.part.1"]);
  const partTraces = part.filter((event) => event.kind === "trace");
  assert.equal(partTraces.length, 1, "a part gets one trace");
  const ring = pictureTextRingPath(PART_R1);
  assert.equal(partTraces[0]!.path, ring.path, "the part's trace is the text ring");
  const card = rectPath(PICTURE.x - PICTURE_CARD_PADDING_PX, PICTURE.y - PICTURE_CARD_PADDING_PX,
    PICTURE.width + PICTURE_CARD_PADDING_PX * 2, PICTURE.height + PICTURE_CARD_PADDING_PX * 2);
  assert(partTraces[0]!.path !== card, "a part never traces the whole card");
  const partWorst = assertRingHugs(ring.path, PART_R1, "R1");
  const partFlights = part.filter((event) => event.kind === "fly");
  assert.deepEqual(partFlights.at(-1), { kind: "fly", x: ring.x, y: ring.y }, "the pen lands where the ring starts");
  const partVeils = part.filter((event) => event.kind === "spotlight" && event.veil);
  assert(partVeils.length > 0, "a spotlit part raises a veil");
  for (const veil of partVeils) {
    assert(veil.kind === "spotlight");
    assert.deepEqual(veil.veil, zoneOf(REFERENCE_PICTURE_ZONE), "the veil covers the picture zone, not the diagram zone");
    assertSameRect(veil.hole, pictureFocusHole(PART_R1), "the hole is the part, not the picture");
  }

  // A key entry: the located mark on the drawing, then its row in the key,
  // the spotlight following the pen instead of one hole spanning both.
  const key = await runFocus(pictureDiagram(), "reference_picture.key.1|spotlight", ["reference_picture.key.1"]);
  const keyTraces = key.filter((event) => event.kind === "trace").map((event) => event.kind === "trace" ? event.path : "");
  assert.deepEqual(keyTraces, [pictureTextRingPath(KEY_MARK).path, pictureTextRingPath(KEY_ROW).path], "mark first, then the key row");
  const markWorst = assertRingHugs(keyTraces[0]!, KEY_MARK, "mark 3");
  const rowWorst = assertRingHugs(keyTraces[1]!, KEY_ROW, "key row 3", 16);
  const holes = key.flatMap((event) => event.kind === "spotlight" && event.hole ? [event.hole] : []);
  assert(holes.length >= 2, "the spotlight re-aims inside the key entry");
  assertSameRect(holes[0], pictureFocusHole(KEY_MARK), "the veil opens on the mark");
  assertSameRect(holes.at(-1), pictureFocusHole(KEY_ROW), "and moves to the key row");
  assert(holes.every((hole) => hole.width <= pictureFocusHole(KEY_ROW).width && hole.height <= pictureFocusHole(KEY_ROW).height),
    "no hole spans the mark and the row together");
  // The whole ring is lit: a ring round a tall key row overran a fixed pad
  // and its round ends were dimmed (render proof, 28 Oct 2026).
  for (const [rect, name] of [[PART_R1, "R1"], [KEY_MARK, "mark 3"], [KEY_ROW, "key row 3"]] as const) {
    assertRingInside(pictureTextRingPath(rect).path, pictureFocusHole(rect), name);
  }
  const order = key.filter((event) => event.kind !== "fly").map((event) =>
    event.kind === "trace" ? (event.path === keyTraces[0] ? "trace:mark" : "trace:row")
      : event.hole && Math.abs(event.hole.x - pictureFocusHole(KEY_MARK).x) < 1e-6 ? "hole:mark" : event.hole ? "hole:row" : "down");
  assert(order.indexOf("hole:row") > order.indexOf("trace:mark") && order.indexOf("hole:row") < order.indexOf("trace:row"),
    `the hole moves between the two rings (${order.join(",")})`);

  // With no schedule (no audio clock) the part still gets the text ring.
  const unscheduled = await runFocus(pictureDiagram(), "reference_picture.part.1|spotlight", null);
  assert.deepEqual(unscheduled.filter((event) => event.kind === "trace").map((event) => event.kind === "trace" ? event.path : ""),
    [ring.path], "unscheduled part focus rings the text");
  const unscheduledVeil = unscheduled.find((event) => event.kind === "spotlight" && event.veil);
  assert(unscheduledVeil?.kind === "spotlight");
  assert.deepEqual(unscheduledVeil.veil, zoneOf(REFERENCE_PICTURE_ZONE), "unscheduled part focus veils the picture zone");
  assertSameRect(unscheduledVeil.hole, pictureFocusHole(PART_R1), "unscheduled part focus lights the whole ring");

  // The whole picture with part focus off is exactly what it was: the card
  // trace under the diagram zone's veil.
  for (const scheduleIds of [["reference_picture"], null]) {
    const whole = await runFocus(pictureDiagram(false), "reference_picture|spotlight", scheduleIds);
    const traces = whole.filter((event) => event.kind === "trace");
    assert.equal(traces.length, 1, "the whole picture traces once");
    assert(traces[0]!.kind === "trace" && traces[0]!.path === card, "the whole picture traces its card");
    const veil = whole.find((event) => event.kind === "spotlight" && event.veil);
    assert(veil?.kind === "spotlight");
    assert.deepEqual(veil.veil, DIAGRAM_VEIL, "a whole picture keeps the diagram zone's veil");
  }
  console.log(JSON.stringify({ case: "picture-part-focus", worstGapPx: { part: +partWorst.toFixed(1), mark: +markWorst.toFixed(1), row: +rowWorst.toFixed(1) }, keyOrder: order }));
}

/**
 * The same gestures on the diagram the turn actually builds from a record
 * (lane B's anchors and groups): the ring lands on the part's box mapped
 * the way the pencil maps the picture, and on the key row the layout sets.
 */
async function builtPictureFocusCase(): Promise<void> {
  const record: ReferencePictureRecord = {
    id: "rp_000000000000000000000002", source: "wikimedia", title: "File:Kidney.svg", pageUrl: null,
    license: "CC BY-SA 4.0", licenseUrl: null, artist: "Someone", imageUrl: "/x.png", planUrl: "/x.json",
    width: 960, height: 760, shows: "a kidney and nephron", labels: ["Renal pelvis"],
    legend: [{ mark: "1", label: "Renal cortex" }, { mark: "2", label: "Medulla" }],
    parts: [
      { id: "reference_picture.part.1", label: "Renal pelvis", box: { x: 300, y: 200, width: 96, height: 14 }, source: "svg" },
      { id: "reference_picture.part.2", label: "Medulla", mark: "2", box: { x: 120, y: 340, width: 9, height: 13 }, source: "svg" },
    ],
    plan: { width: 760, height: 600, outlineLengthPx: 4000, fillLengthPx: 4000 },
  };
  const diagram = buildReferencePicturePresentation(record, { partFocus: true }).diagram;
  const layout = referencePictureLayout(record)!;
  const partRect = referencePicturePartBoardRect(record.parts![0]!, layout.picture, record.plan);
  const markRect = referencePicturePartBoardRect(record.parts![1]!, layout.picture, record.plan);
  const rowRect = referencePictureLegendEntryRect(layout.legend!, 1)!;
  const part = await runFocus(diagram, "reference_picture.part.1|spotlight", ["reference_picture.part.1"]);
  assert.deepEqual(part.flatMap((event) => event.kind === "trace" ? [event.path] : []), [pictureTextRingPath(partRect).path],
    "the built part anchor is ringed where the pencil drew its text");
  const key = await runFocus(diagram, "reference_picture.key.2|spotlight", ["reference_picture.key.2"]);
  assert.deepEqual(key.flatMap((event) => event.kind === "trace" ? [event.path] : []),
    [pictureTextRingPath(markRect).path, pictureTextRingPath(rowRect).path], "the built key entry: its mark, then its row");
  const veil = key.find((event) => event.kind === "spotlight" && event.veil);
  assert(veil?.kind === "spotlight");
  assert.deepEqual(veil.veil, zoneOf(REFERENCE_PICTURE_ZONE), "the built key entry veils the picture zone");
  const off = buildReferencePicturePresentation(record, { partFocus: false }).diagram;
  const offFocus = await runFocus(off, "reference_picture.part.1|spotlight", ["reference_picture.part.1"]);
  assert.equal(offFocus.length, 0, "with part focus off a part id draws nothing");
  console.log(JSON.stringify({ case: "picture-part-focus-built", anchors: diagram.anchors.map((anchor) => anchor.id) }));
}

/**
 * Run the same focuses through a baseline executor (a git ref) and this one:
 * a verified diagram and a whole picture must move the pen, draw and veil
 * identically. Only with `--baseline=<ref>`, since the ref must exist.
 */
async function baselineParity(ref: string): Promise<void> {
  const text = execFileSync("git", ["show", `${ref}:apps/tutor/features/tutor-session/hooks/useCommandExecution.ts`], {
    cwd: path.dirname(EXECUTOR), encoding: "utf8",
  });
  const baseline = loadExecutor(text);
  const runs: Array<[() => VerifiedDiagram, string, string[] | null]> = [
    [verifiedDiagram, "B,C|spotlight", ["B", "C"]],
    [verifiedDiagram, "B|pulse", ["B"]],
    [verifiedDiagram, "B,C|spotlight", null],
    [() => pictureDiagram(false), "reference_picture|spotlight", ["reference_picture"]],
    [() => pictureDiagram(false), "reference_picture|pulse", null],
  ];
  for (const [diagram, id, scheduleIds] of runs) {
    const before = await runFocus(diagram(), id, scheduleIds, baseline);
    const after = await runFocus(diagram(), id, scheduleIds);
    assert.deepEqual(after, before, `${id}: same board events as ${ref}`);
    console.log(JSON.stringify({ case: "baseline-parity", ref, id, scheduled: Boolean(scheduleIds), events: after.length }));
  }
}

const cases: Record<string, () => Promise<void>> = {
  "picture-part-focus": pictureFocusCases,
  "picture-part-focus-built": builtPictureFocusCase,
  "successor-release": () => ownershipCase("successor-release"),
  "committed-lease": () => ownershipCase("committed-lease"),
  "code-committed-lease": () => ownershipCase("code-committed-lease"),
  "null-spec": () => ownershipCase("null-spec"),
  "later-retargeted-lease": () => ownershipCase("later-retargeted-lease"),
  "clear-new-focus": () => ownershipCase("clear-new-focus"),
  "normal-latest-target": async () => {
    const f = fixture();
    let raises = 0;
    let globalClears = 0;
    let settled = false;
    const nativeSpotlight = f.board.setSpotlight;
    f.board.setSpotlight = (spec) => {
      if (spec) raises++; else globalClears++;
      return nativeSpotlight(spec);
    };
    const job = f.executor.executeCommandWithCancel(f.focus("B,C|spotlight"), { ...f.schedule(["B", "C"]), isCancelled: () => false })
      .then(() => { settled = true; });
    try {
      await flush(); await f.advance(5000);
      assert(settled, "two-target focus finishes normally");
      assert.equal(raises, 3, "union plus both target installations");
      console.log(JSON.stringify({ case: "normal-latest-target", raises, globalClears, remainingVeils: f.veils().length }));
      assert.equal(f.veils().length, 0, "cleanup releases the latest target, not just the union");
      assert.equal(globalClears, 0, "production leases never fall back to global null cleanup");
    } finally { f.board.cancelAnimations(); await flush(); await job; unmountTestWhiteboard(f.board); }
  },
  "unscheduled-flight-cancellation": () => cancellationFlight("unscheduled"),
  "code-tour-flight-cancellation": () => cancellationFlight("code-tour"),
  "code-spoken-walk-flight-cancellation": () => cancellationFlight("code-spoken-walk"),
  "deferred-label-flight-cancellation": () => cancellationFlight("deferred-label"),
  "flight-cancellation": async () => {
    const f = fixture();
    let cancelled = false;
    let settled = false;
    const flights: Parameters<typeof f.board.flyCursorTo>[] = [];
    const fly = f.board.flyCursorTo;
    f.board.flyCursorTo = (...args) => { flights.push(args); return fly(...args); };
    const job = f.executor.executeCommandWithCancel(f.focus(), {
      ...f.schedule(), isCancelled: () => cancelled,
    }).then(() => { settled = true; });
    try {
      await flush();
      assert.equal(flights.length, 1, "reach the actual scheduled executor flight");
      assert(!settled, "the real cursor flight must still be pending");
      f.board.setPaused(true); cancelled = true;
      await f.advance(64);
      console.log(JSON.stringify({ case: "flight-cancellation", predicate: typeof flights[0]![4], settledWhilePaused: settled }));
      assert(settled, "executor forwards cancellation so the real cursor joins while paused");
      assert.equal(typeof flights[0]![4], "function", "the fifth argument reaches Whiteboard");
      assert.equal(f.veils().length, 0, "cancelled focus removes its own veil");
    } finally {
      cancelled = true; f.board.cancelAnimations(); await flush(); await job;
      unmountTestWhiteboard(f.board);
    }
  },
};

async function main() {
  const baselineRef = process.argv.find((arg) => arg.startsWith("--baseline="))?.slice(11);
  if (baselineRef) {
    await baselineParity(baselineRef);
    console.log(`PASS baseline-parity ${baselineRef}`);
    return;
  }
  const selected = process.argv.find((arg) => arg.startsWith("--case="))?.slice(7);
  const names = selected ? [selected] : Object.keys(cases);
  for (const name of names) {
    assert(cases[name], `unknown regression: ${name}`);
    await cases[name]!();
    console.log(`PASS ${name}`);
  }
  console.log(`verify-focus-executor-integration: ${names.length} executor regressions passed`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
