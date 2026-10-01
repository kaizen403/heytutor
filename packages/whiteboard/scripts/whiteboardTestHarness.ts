import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import Konva from "konva";
import * as drawing from "@heytutor/drawing";
import type { WhiteboardHandle } from "../src/Whiteboard";

const disposers = new WeakMap<WhiteboardHandle, () => void>();
const boardRefs = new WeakMap<WhiteboardHandle, Array<{ current: unknown }>>();

export function getTestWhiteboardRefs(board: WhiteboardHandle): Array<{ current: unknown }> {
  return boardRefs.get(board) ?? [];
}

/** Actual Stage/Layer and VirtualCursor refs/effects; only React reconciliation and pixel paint are simulated. */
export function mountTestWhiteboard(sourceFile?: string, paths = drawing.textToStrokePaths): WhiteboardHandle {
  const requireBoard = createRequire(new URL("../package.json", import.meta.url));
  const file = sourceFile ?? process.env.WHITEBOARD_TEST_SOURCE ?? fileURLToPath(new URL("../src/Whiteboard.tsx", import.meta.url));
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const effects: Array<() => unknown> = [];
  const refs: Array<{ current: unknown }> = [];
  const react = {
    forwardRef: (render: unknown) => render,
    useRef: (current: unknown) => { const ref = { current }; refs.push(ref); return ref; },
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => unknown) => effects.push(fn),
    useLayoutEffect: (fn: () => unknown) => effects.push(fn),
    useState: (value: unknown) => [typeof value === "function" ? value() : value, () => {}],
    useImperativeHandle: (ref: { current: unknown }, make: () => unknown) => { ref.current = make(); },
  };
  const cache = new Map<string, Record<string, unknown>>();
  function load(source: string): Record<string, unknown> {
    if (cache.has(source)) return cache.get(source)!;
    const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const mod = { exports: {} };
    const localRequire = (specifier: string) => {
      if (specifier === "react") return react;
      if (specifier === "konva") return { __esModule: true, default: Konva };
      if (specifier === "@heytutor/drawing") return { ...drawing, textToStrokePaths: paths };
      if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (specifier === "react-konva") return Object.fromEntries(
        ["Layer", "Stage", "Path", "Rect", "Group", "Circle", "Ellipse", "Line"].map((name) => [name, name]),
      );
      if (specifier.startsWith(".")) {
        const resolved = path.resolve(path.dirname(source), specifier);
        return load(existsSync(`${resolved}.ts`) ? `${resolved}.ts` : `${resolved}.tsx`);
      }
      return requireBoard(specifier);
    };
    new Function("require", "module", "exports", compiled)(localRequire, mod, mod.exports);
    cache.set(source, mod.exports);
    return mod.exports;
  }
  // Keep the inert painter installed for nodes created after mount (e.g. fallback Text).
  // Verifier scripts each run in their own process; this does not affect browser tests.
  Konva.Util.createCanvasElement = () => {
    const context = new Proxy({
      measureText: (text: string) => ({ width: text.length * 16 }),
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    }, { get(target, key) {
      if (key in target) return target[key as keyof typeof target];
      if (String(key).includes("BackingStore")) return 1;
      return () => {};
    } });
    return { style: {}, width: 0, height: 0, getContext: () => context, remove() {}, toDataURL: () => "" } as unknown as HTMLCanvasElement;
  };
  const { Whiteboard } = load(file) as { Whiteboard: (props: object, ref: object) => unknown };
  const ref = { current: null as WhiteboardHandle | null };
  const tree = Whiteboard({ cursorState: "drawing", thinkingMotion: "none" }, ref);
  function mount(element: unknown, parent?: Konva.Container) {
    if (!element || typeof element !== "object") return;
    if (Array.isArray(element)) { for (const child of element) mount(child, parent); return; }
    const { type, props = {} } = element as { type: string | ((props: object, ref: unknown) => unknown); props?: Record<string, unknown> };
    if (typeof type === "function") { mount(type(props, props.ref), parent); return; }
    const { ref: nodeRef, children, ...attrs } = props;
    const ctor = (Konva as unknown as Record<string, new (attrs: object) => Konva.Node>)[type];
    let node = parent;
    if (ctor) {
      const created = new ctor(attrs);
      if (created instanceof Konva.Layer) created.batchDraw = () => created;
      if (nodeRef) (nodeRef as { current: unknown }).current = created;
      if (parent) parent.add(created);
      node = created instanceof Konva.Container ? created : parent;
    }
    for (const child of Array.isArray(children) ? children : [children]) mount(child, node);
  }
  mount(tree);
  const cleanups = effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => typeof cleanup === "function");
  if (!ref.current) throw new Error("Whiteboard did not publish its imperative adapter");
  const board = ref.current;
  boardRefs.set(board, refs);
  disposers.set(board, () => {
    const stage = board.getDrawLayer()?.getStage();
    board.cancelAnimations();
    for (const cleanup of cleanups) cleanup();
    stage?.destroy();
  });
  return board;
}

export function unmountTestWhiteboard(board: WhiteboardHandle): void {
  disposers.get(board)?.();
  disposers.delete(board);
  boardRefs.delete(board);
}
