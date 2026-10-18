/** Phone font floor through actual shell/viewport consumers and native handwriting paths. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import Konva from "konva";
import * as React from "react";
import { BOARD_TYPE_SCALE, fitBoardText, textToStrokePaths } from "@heytutor/drawing";
import type { VerifiedDiagram } from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { BoardReadingInput, useBoardReading as ReadingHook } from "../../features/tutor-session/hooks/useBoardReading";
import type { useBoardLayout as LayoutHook } from "../../features/tutor-session/hooks/useBoardLayout";
import type { useCommandExecution as CommandHook } from "../../features/tutor-session/hooks/useCommandExecution";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const ref = <T>(current: T) => ({ current });
const react = { useRef: ref, useCallback: (fn: unknown) => fn, useEffect() {} };
function load<T>(relative: string, source = path.join(app, relative), hooks: unknown = react): T {
  const file = path.join(app, relative);
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return hooks;
    if (specifier === "./useBoardViewport") return { useBoardViewport: () => ({ scale: 1, offsetX: 0, offsetY: 0 }) };
    return requireApp(specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : specifier);
  }, mod, mod.exports);
  return mod.exports as T;
}
const reading = load<{ useBoardReading: typeof ReadingHook; minimumVisibleBoardFontSize: (board: WhiteboardHandle) => number | null }>(
  "features/tutor-session/hooks/useBoardReading.ts", process.env.PHONE_READING_SOURCE,
);
function readingFixture(board: WhiteboardHandle, enabled = true) {
  type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
  const slots: Slot[] = []; let slotIndex = 0;
  const effects: Array<() => void> = [];
  const hooks = {
    useRef: <T,>(initial: T) => {
      const slot = slots[slotIndex] ?? (slots[slotIndex] = {}); slotIndex++;
      slot.value ??= { current: initial }; return slot.value as { current: T };
    },
    useEffect: (fn: () => void | (() => void), deps: readonly unknown[]) => {
      const slot = slots[slotIndex] ?? (slots[slotIndex] = {}); slotIndex++;
      if (slot.deps && deps.every((item, i) => Object.is(item, slot.deps![i]))) return;
      slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = fn() || undefined; });
    },
  };
  const mounted = load<{ useBoardReading: typeof ReadingHook }>("features/tutor-session/hooks/useBoardReading.ts", process.env.PHONE_READING_SOURCE, hooks);
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const frames = new Map<number, FrameRequestCallback>(); let id = 0;
  for (const [key, value] of Object.entries({
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: (frame: number) => frames.delete(frame),
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const moves: Array<{ left: number; top: number }> = [];
  const pane = { scrollLeft: 0, scrollTop: 0, clientWidth: 340, clientHeight: 250, scrollWidth: 1042, scrollHeight: 620,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    querySelector: () => ({ getBoundingClientRect: () => ({ left: 10 - pane.scrollLeft, top: 10 - pane.scrollTop }) }),
    scrollTo: ({ left, top }: { left: number; top: number }) => { pane.scrollLeft = left; pane.scrollTop = top; moves.push({ left, top }); },
  };
  const fonts: Array<number | null> = [];
  const input: BoardReadingInput = { enabled, follow: true, boardRef: ref(board),
    paneRef: ref(pane as unknown as HTMLDivElement), scale: 16 / 19, scope: "current lesson", diagram: null,
    onMinimumFontSize: size => fonts.push(size) };
  const render = (patch: Partial<BoardReadingInput> = {}) => {
    Object.assign(input, patch); slotIndex = 0; mounted.useBoardReading(input); for (const effect of effects.splice(0)) effect();
  };
  render();
  return { pane, moves, fonts, input, render,
    frame() { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(0); },
    close() { for (const slot of slots) slot.cleanup?.(); assert.equal(frames.size, 0, "unmount cancels the reading observer"); for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    } },
  };
}

async function followConsumers() {
  const board = mountTestWhiteboard(), other = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock(); board.setTimeSource(clock.source); other.setTimeSource(clock.source);
  const fixture = readingFixture(board);
  const cancel = ref(false), whiteboard = ref(board), fbd = ref(false);
  const layout = load<{ useBoardLayout: typeof LayoutHook }>("features/tutor-session/hooks/useBoardLayout.ts").useBoardLayout({
    whiteboardRef: whiteboard, cancelRef: cancel, fbdPhaseStartedRef: fbd, liveQuestionRef: ref("offline phone control"),
  });
  const diagram: VerifiedDiagram = { id: "visible", name: "visible figure", promptAddon: "", commands: [], reveals: [],
    anchors: [{ id: "far", labels: ["far"], x: 1060, y: 610, width: 60, height: 40 }] };
  const executor = load<{ useCommandExecution: typeof CommandHook }>("features/tutor-session/hooks/useCommandExecution.ts").useCommandExecution({
    whiteboardRef: whiteboard, cancelRef: cancel, activeVerifiedDiagramRef: ref(diagram), fbdPhaseStartedRef: fbd,
    fbdPhaseMarkedRef: ref(false), boardLayoutRef: layout.boardLayoutRef, inkPaceRef: ref("follow"), speedRef: ref(1),
    adaptiveFactorRef: ref(1), forceSequentialWorkLayoutRef: layout.forceSequentialWorkLayoutRef, turnTelemetryRef: ref(null),
    notesEpochsRef: layout.notesEpochsRef, narrationSinceEpochRef: layout.narrationSinceEpochRef,
    raceWithCancel: async promise => promise, resolveTextPlacement: layout.resolveTextPlacement,
    cancellableDelay: async ms => { const end = clock.now() + ms; while (clock.now() < end) await clock.waitForAdvance(); },
    forgetErasedTextRects: layout.forgetErasedTextRects, resetBoardLayout: layout.resetBoardLayout, nowMs: clock.now,
  });
  const pump = async (task: Promise<unknown>) => {
    let done = false, failure: unknown; void task.then(() => { done = true; }, error => { failure = error; done = true; });
    for (let step = 0; !done && step < 800; step++) {
      clock.advance(16); clock.pump(); fixture.frame();
      for (let micro = 0; micro < 40; micro++) await Promise.resolve();
    }
    if (failure) throw failure;
    assert.ok(done, "real WRITE/POINT settles within the bounded board clock"); fixture.frame();
  };
  try {
    await pump(board.writeText("setup", 90, 80, 0, undefined, 27)); fixture.frame();
    assert.equal(fixture.fonts.at(-1), 27, "actual native paths supply the visible size");
    await pump(executor.executeCommandWithCancel({ type: "WRITE", text: "v = 10 m/s", params: [90, 610, 27] }, { textPlacementReserved: true }));
    assert.ok(fixture.pane.scrollTop > 250, `actual WRITE nib is followed to bottom work: ${JSON.stringify({pane:[fixture.pane.scrollLeft,fixture.pane.scrollTop],moves:fixture.moves,nib:board.getCursorLayer()?.getChildren().map(n=>({type:n.getClassName(),xy:n.position(),visible:n.isVisible(),opacity:n.getAbsoluteOpacity()}))})}`);
    console.log(JSON.stringify({ consumer: "WRITE", scrollLeft: fixture.pane.scrollLeft, scrollTop: fixture.pane.scrollTop }));
    const beforePoint = board.getDrawLayer()!.getChildren().map(node => node.toObject());
    await pump(executor.executeCommandWithCancel({ type: "POINT", text: "far", params: [] }, { segmentNarration: "The far verified target.", speechDurationMs: 1000, speechShareMs: 1000 }));
    assert.ok(fixture.pane.scrollLeft > 500, "actual POINT nib is followed into the far figure");
    console.log(JSON.stringify({ consumer: "POINT", scrollLeft: fixture.pane.scrollLeft, scrollTop: fixture.pane.scrollTop }));
    assert.deepEqual(board.getDrawLayer()!.getChildren().map(node => node.toObject()), beforePoint, "following a POINT adds or changes no ink");
    // A POINT can land between reading frames with no coordinate delta.
    const nib = board.getCursorLayer()!.getChildren().find(node => node.getClassName() === "Group")!;
    board.setCursorPos(1090, 610); fixture.frame(); fixture.pane.scrollLeft = 0; fixture.pane.scrollTop = 0;
    const beforeImmediate = nib.position();
    const immediate = executor.executeCommandWithCancel({ type: "POINT", text: "far", params: [] }, { segmentNarration: "far", speechDurationMs: 700, speechShareMs: 700 });
    for (let micro = 0; micro < 40; micro++) await Promise.resolve();
    fixture.frame(); assert.deepEqual(nib.position(), beforeImmediate, "POINT begins at its stationary target before any board-clock advance");
    assert.ok(fixture.pane.scrollLeft > 500, "a new same-position POINT is followed before any movement sample");
    await pump(immediate);
    fixture.render({ follow: false }); fixture.pane.scrollLeft = 17; fixture.pane.scrollTop = 23; fixture.frame();
    board.setCursorPos(1100, 650); fixture.frame();
    assert.deepEqual([fixture.pane.scrollLeft, fixture.pane.scrollTop], [17, 23], "pause leaves manual two-axis pan entirely free");
    fixture.render({ follow: true }); fixture.frame();
    assert.ok(fixture.pane.scrollLeft > 500 && fixture.pane.scrollTop > 250, "same-owner resume reveals the active stationary target before any new ink");
    board.setCursorPos(1090, 640); fixture.frame();
    assert.ok(fixture.pane.scrollLeft > 500 && fixture.pane.scrollTop > 250, "new owned movement resumes follow");
    await other.writeText("new page", 90, 80, 0, undefined, 32); other.setCursorPos(1100, 650);
    fixture.input.boardRef.current = other; fixture.pane.scrollLeft = 0; fixture.pane.scrollTop = 0; fixture.frame();
    assert.deepEqual([fixture.pane.scrollLeft, fixture.pane.scrollTop], [0, 0], "new board never inherits the previous cursor position");
    board.setCursorPos(1120, 660); fixture.frame();
    assert.equal(fixture.pane.scrollLeft, 0, "retired owner's movement cannot pan the displayed board");
    other.setCursorPos(1080, 630); fixture.frame(); assert.ok(fixture.pane.scrollLeft > 500);
    fixture.render({ enabled: false }); fixture.pane.scrollLeft = 0; fixture.pane.scrollTop = 0; fixture.frame();
    other.setCursorPos(1090, 640); fixture.frame();
    assert.equal(fixture.pane.scrollLeft, 0, "disabled/headless observer never follows visible moving ink");
    fixture.render({ enabled: true }); fixture.frame();
    other.getDrawLayer()!.destroyChildren(); await other.writeText("replacement", 90, 80, 0, undefined, 32);
    other.setCursorPos(1100, 650); fixture.frame();
    assert.equal(fixture.pane.scrollLeft, 0, "replacement page fences a stale cursor even without an empty intermediate frame");
    other.setCursorPos(1080, 630); fixture.frame(); assert.ok(fixture.pane.scrollLeft > 500);
    other.getDrawLayer()!.destroyChildren(); other.getDrawLayer()!.add(new Konva.Text({ text: "new page", x: 90, y: 80, fontSize: 32 }));
    other.setCursorPos(1090, 610); fixture.pane.scrollLeft = 0; fixture.pane.scrollTop = 0;
    fixture.frame(); fixture.frame();
    assert.equal(fixture.pane.scrollLeft, 0, "page replacement with no accepted activity remains fenced on later stationary samples");
    other.getDrawLayer()!.destroyChildren(); other.getDrawLayer()!.add(new Konva.Text({ text: "next page", x: 90, y: 80, fontSize: 32 }));
    whiteboard.current = other;
    const pagePoint = executor.executeCommandWithCancel({ type: "POINT", text: "far", params: [] }, { segmentNarration: "far", speechDurationMs: 700, speechShareMs: 700 });
    for (let micro = 0; micro < 40; micro++) await Promise.resolve();
    fixture.frame(); fixture.frame();
    assert.ok(fixture.pane.scrollLeft > 500, "accepted zero-distance POINT after same-interval page replacement is followed within two reading frames");
    await pump(pagePoint);
    other.getDrawLayer()!.destroyChildren(); fixture.pane.scrollLeft = 0; fixture.pane.scrollTop = 0;
    other.setCursorPos(1150, 680); fixture.frame();
    assert.equal(fixture.pane.scrollLeft, 0, "empty/retired page never follows its stale nib");
    assert.equal(fixture.fonts.at(-1), null, "retired page text no longer controls scale");
    fixture.render({ enabled: false }); other.setCursorPos(1180, 690); fixture.frame();
    assert.equal(fixture.pane.scrollLeft, 0, "headless/desktop disabled observer never pans");
  } finally { fixture.close(); unmountTestWhiteboard(board); unmountTestWhiteboard(other); }
}

async function main(): Promise<void> {
  process.env.PHONE_BOARD_READABILITY_ONLY = "1";
  const shell = await import("./verify-mobile-caption-dock");
  const { phoneViewportScales, viewportFixture } = shell;
  assert.equal(phoneViewportScales.length, 4);
  const board = mountTestWhiteboard();
  try {
    for (const [width, height, fontSize] of [[744, 1133, 27], [700, 900, 32]] as const) {
      board.getDrawLayer()!.destroyChildren(); await board.writeText("v = 10 m/s", 90, 80, 0, undefined, fontSize);
      const minimum = reading.minimumVisibleBoardFontSize(board);
      assert.equal(minimum, fontSize, "measure actual visible native handwriting, not a global minimum");
      const fixture = viewportFixture(width, height, 0, "readable-scroll", 0, minimum);
      try {
        const fitted = fixture.read(); assert.equal(fitted.scrollable, false); assert.equal(fitted.scale, (width - 32) / 1200);
        console.log(JSON.stringify({ width, height, renderedFontSize: minimum, scale: fitted.scale, fontCssPx: minimum! * fitted.scale, scrollable: fitted.scrollable }));
        shell.shellMarkup({ mobile: true, width, height, coarse: width === 744, recorded: false, viewportScale: fitted.scale, scrollable: fitted.scrollable, minimumVisibleFontSize: minimum });
        assert.equal(shell.phoneShellMinimum, minimum, "actual shell forwards the rendered metric to its viewport");
        assert.equal(shell.phoneShellReading?.follow, false, "fitted page does not start following/panning");
        const small = new Konva.Text({ text: "given", fontSize: 19, visible: false }); board.getDrawLayer()!.add(small);
        assert.equal(reading.minimumVisibleBoardFontSize(board), fontSize, "hidden/future label is not visible text");
        small.visible(true); assert.equal(reading.minimumVisibleBoardFontSize(board), 19);
        const enlarged = fixture.fontSize(reading.minimumVisibleBoardFontSize(board));
        assert.equal(enlarged.scale, 16 / 19); assert.equal(enlarged.scrollable, true, "actual small visible label takes the readable exception");
        console.log(JSON.stringify({ width, renderedFontSize: 19, scale: enlarged.scale, fontCssPx: 19 * enlarged.scale, scrollable: enlarged.scrollable }));
        small.destroy(); const restored = fixture.fontSize(reading.minimumVisibleBoardFontSize(board));
        assert.equal(restored.scale, fitted.scale); assert.equal(restored.scrollable, false, "retired label restores old fit");
        const keyboard = fixture.resize({ height: height - 180, keyboardInset: 180 }); assert.equal(keyboard.scale, fitted.scale);
        for (const retiredSize of [fontSize, null]) {
          fixture.fontSize(19);
          const held = fixture.fontSize(retiredSize);
          assert.equal(held.scale, 16 / 19, "keyboard holds the accepted readable scale while a small label is retired");
          const closed = fixture.visualResize({ height, keyboardInset: 0 });
          assert.equal(closed.scale, fitted.scale, "same-box keyboard close honors pending content fit after label retirement");
          assert.equal(closed.scrollable, false);
          fixture.resize({ height: height - 180, keyboardInset: 180 });
        }
      } finally { fixture.close(); }
    }
    board.getDrawLayer()!.destroyChildren();
    assert.equal(reading.minimumVisibleBoardFontSize(board), null);
    const empty = viewportFixture(390, 600, 80, "readable-scroll", 0, null);
    try { assert.equal(empty.read().scale, 370 / 1200); assert.equal(empty.read().scrollable, false); } finally { empty.close(); }
    for (const [index, fontSize] of Object.values(BOARD_TYPE_SCALE).entries()) {
      const text = index === 2 ? "check: 10 = -(-10)" : "v = 10 m/s";
      const paths = await textToStrokePaths(text, 90, 80 + index * 90, fontSize);
      assert.ok(paths.some(char => char.strokes.length > 0), "real handwriting ink exists");
      const expected = paths.flatMap(char => char.strokes.map(stroke => stroke.pathData));
      const beforeCount = board.getDrawLayer()!.getChildren().length;
      await board.writeText(text, 90, 80 + index * 90, 0, undefined, fontSize);
      for (const scale of phoneViewportScales) assert.ok(fontSize * scale >= 16 - 1e-8, "every role meets16CSSpx in the actual viewport");
      const actual = board.getDrawLayer()!.getChildren().slice(beforeCount)
        .filter(node => node.getClassName() === "Path").map(node => node.getAttrs().data);
      assert.deepEqual(actual, expected, "actual Whiteboard preserves canonical native stroke paths and font size");
    }
    assert.ok(board.getDrawLayer()!.getChildren().length > 0, "actual Whiteboard commits native ink");
    const short = fitBoardText("v = 10 m/s", { role: "work", maxWidth: 282 });
    const wrapped = fitBoardText("The image is real and inverted and on the same side as the object", { role: "work", maxWidth: 282 });
    assert.equal(short.fontSize, 27); assert.equal(wrapped.fontSize, 27); assert.ok(wrapped.lines.length > 1);
    const token = fitBoardText("CH3CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2OH", { role: "work", maxWidth: 282 });
    assert.equal(token.fontSize, 19, "unbreakable-token fallback is covered by the phone floor");
  } finally { unmountTestWhiteboard(board); }
  const policies: Array<Parameters<typeof shell.shellMarkup>[0] & { follow: boolean }> = [
    { phase: "drawing", follow: true }, { phase: "speaking", follow: true },
    { phase: "speaking", paused: true, follow: false }, { phase: "idle", follow: false },
    { playerActive: true, playerPlaying: true, follow: true }, { playerActive: true, playerPlaying: false, follow: false },
    { rewind: true, rewindPlaying: true, follow: true }, { rewind: true, rewindPlaying: false, follow: false },
    { variant: "headless", follow: false },
  ];
  for (const options of policies) {
    shell.shellMarkup({ mobile: true, width: 390, height: 844, scrollable: true, recorded: false, ...options });
    assert.equal(Boolean(shell.phoneShellReading?.follow), options.follow, `actual shell follow policy ${JSON.stringify(options)}`);
    if (options.variant !== "headless") {
      const findCanvas = (node: React.ReactNode): Record<string, unknown> | null => {
        if (Array.isArray(node)) { for (const child of node) { const found = findCanvas(child); if (found) return found; } return null; }
        if (!React.isValidElement<Record<string, unknown>>(node)) return null;
        return Object.hasOwn(node.props, "whiteboardRef") ? node.props : findCanvas(node.props.children as React.ReactNode);
      };
      const canvas = findCanvas(shell.phoneShellTree()); assert.ok(canvas);
      const wanted = options.playerActive ? canvas.playerBoardRef : options.rewind ? canvas.rewindBoardRef : canvas.whiteboardRef;
      assert.equal(shell.phoneShellReading?.boardRef, wanted, "actual shell follows only the displayed owner");
    } else assert.equal(shell.phoneShellReading?.enabled, false, "capture has no viewport observer");
  }
  const findPan = (node: React.ReactNode): Record<string, unknown> | null => {
    if (Array.isArray(node)) { for (const child of node) { const found = findPan(child); if (found) return found; } return null; }
    if (!React.isValidElement<Record<string, unknown>>(node)) return null;
    return node.props["data-board-scroll"] === "true" ? node.props : findPan(node.props.children as React.ReactNode);
  };
  shell.shellMarkup({ mobile: true, width: 390, height: 844, scrollable: true, paused: true });
  const pan = findPan(shell.phoneShellTree()); assert.ok(pan);
  const keyDown = pan.onKeyDown as (event: Record<string, unknown>) => void;
  for (const key of ["Home", "End"]) {
    let destination: unknown;
    const pane = { scrollWidth: 1042, scrollHeight: 620, scrollTo: (value: unknown) => { destination = value; } };
    keyDown({ key, target: pane, currentTarget: pane, preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(destination, { left: key === "Home" ? 0 : 1042, top: key === "Home" ? 0 : 620 }, "actual focused pan Home/End reaches both axes");
  }
  await followConsumers();
  console.log("Phone board readability: actual role floor, pan, keyboard/deck, capture and native ink GREEN");

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
