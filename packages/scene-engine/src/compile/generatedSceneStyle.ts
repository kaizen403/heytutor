/**
 * Cosmetic paint on freshly source-proved native geometry. A style request
 * supplies only a fixed palette id; it cannot supply ink, labels or a scene.
 * Neither compilation nor complete replay comparison grants image admission.
 *
 * This composition leaf never installs source replay or imports the barrel.
 * Native source, numeric, geometry, inventory and staging proofs stay in the
 * guide compiler. Its existing raster correspondence policy is independent.
 */
import { textToStrokePathsSync } from "@heytutor/drawing";
import { compileGeneratedSceneGuide, GENERATED_SCENE_GUIDE_SCHEMA, type GeneratedSceneGuide } from "./generatedSceneGuide";
import { SCENE_ENGINE_VERSION } from "../types";

export const SCIENTIFIC_STYLE_SCHEMA = "scientific-style/v1" as const;
export const GENERATED_SCENE_STYLE_SCHEMA = "generated-scene-style/v1" as const;
const PALETTES_VERSION = "scientific-style-palettes/v1" as const;
const FRAME_SCHEMA = "generated-scene-style-frame/v2" as const;
type Frozen<T> = T extends object ? { readonly [K in keyof T]: Frozen<T[K]> } : T;

/** High-contrast dark ink on white; light fill is used ONLY on existing regions. */
export const SCIENTIFIC_STYLE_PALETTES = freeze([
  { paletteId: "navy", ink: "#17324d", regionFill: "#e5edf5" },
  { paletteId: "teal", ink: "#0b4a48", regionFill: "#e0f0ec" },
  { paletteId: "indigo", ink: "#35336b", regionFill: "#eae7f6" },
  { paletteId: "forest", ink: "#1f4b35", regionFill: "#e4f0e5" },
  { paletteId: "slate", ink: "#334155", regionFill: "#e9edf1" },
  { paletteId: "burgundy", ink: "#632b3f", regionFill: "#f4e4eb" },
] as const);
export type ScientificStylePaletteId = typeof SCIENTIFIC_STYLE_PALETTES[number]["paletteId"];
export interface ScientificStyle {
  readonly schema: typeof SCIENTIFIC_STYLE_SCHEMA;
  readonly paletteId: ScientificStylePaletteId;
}
export interface GeneratedSceneStyleInput { sourceInput: unknown; style: ScientificStyle }
interface StyleRenderData {
  schema: typeof GENERATED_SCENE_STYLE_SCHEMA;
  purpose: "native_geometry_cosmetic_style";
  accepted: false;
  automaticAdmission: false;
  style: ScientificStyle;
  /** Complete, unmodified fresh native guide, including every deferred label. */
  guide: GeneratedSceneGuide;
  image: { width: number; height: number; svg: string };
  frame: {
    width: 1200;
    height: 700;
    pictureBounds: GeneratedSceneGuide["transform"]["pictureBounds"];
    /** Native geometry and setup labels; answer label ink waits for teaching. */
    setupSvg: string;
    /** Offline inspection only: also includes every teaching-complete label. */
    completeDiagnosticSvg: string;
  };
  versions: {
    engine: typeof SCENE_ENGINE_VERSION;
    source: "generated-scene-guide-source/v1";
    guide: typeof GENERATED_SCENE_GUIDE_SCHEMA;
    style: typeof SCIENTIFIC_STYLE_SCHEMA;
    palettes: typeof PALETTES_VERSION;
    frame: typeof FRAME_SCHEMA;
  };
  /** Canonical sorted JSON bytes for app hashing, never an admission receipt. */
  sourcePayload: string;
  guidePayload: string;
  stylePayload: string;
  framePayload: string;
  renderPayload: string;
}
export type GeneratedSceneStyleRender = Frozen<StyleRenderData>;
export interface GeneratedSceneStyleDecline { code: string; message: string; entityIds: readonly string[] }
interface NonAdmission { accepted: false; automaticAdmission: false }
export type GeneratedSceneStyleCompileResult = NonAdmission & (
  | { ok: true; render: GeneratedSceneStyleRender }
  | { ok: false; decline: GeneratedSceneStyleDecline }
);
export type GeneratedSceneStyleVerificationResult = GeneratedSceneStyleCompileResult;

class StyleDecline extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
function fail(code: string, message: string): never { throw new StyleDecline(code, message); }
function freeze<T>(value: T): Frozen<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value as Frozen<T>;
}
// Browser-safe import; Node can additionally refuse proxies before any trap.
const host = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
const util = host?.getBuiltinModule?.("node:util") as { types?: { isProxy?: (value: unknown) => boolean } } | undefined;
function descriptors(value: unknown): Record<string, PropertyDescriptor> {
  if (value === null || typeof value !== "object" || util?.types?.isProxy?.(value) || Object.getOwnPropertySymbols(value).length) {
    fail("invalid_style_data", "Style/source/render data requires plain JSON without proxies or symbols");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (Array.isArray(value) ? Array.prototype : Object.prototype) && prototype !== null) {
    fail("invalid_style_data", "Style/source/render data requires plain records and arrays");
  }
  return Object.getOwnPropertyDescriptors(value);
}
function fields(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  const data = descriptors(raw);
  if (Array.isArray(raw)) fail("invalid_style_input", "Expected a closed plain request");
  return Object.fromEntries(Object.entries(data).map(([key, descriptor]) => {
    if (!allowed.includes(key) || !descriptor.enumerable || !("value" in descriptor)) {
      fail("invalid_style_input", "Caller scenes, coordinates, images, text, paint overrides and accessors are forbidden");
    }
    return [key, descriptor.value];
  }));
}
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
interface Budget { nodes: number; text: number; array: number; string: number; omitUndefined: boolean }
/** Bounded private copy; never calls a getter, iterator, toJSON or coercion. */
function jsonCopy(value: unknown, budget: Budget, depth = 0, active = new Set<object>()): Json {
  if (--budget.nodes < 0 || depth > 40) fail("style_data_limit", "Style/source/render data exceeds its structural bound");
  if (typeof value === "string") {
    if (value.length > budget.string || (budget.text -= value.length) < 0) fail("style_data_limit", "Style/source/render text exceeds its bound");
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid_style_data", "Style/source/render numbers must be finite");
    return value === 0 ? 0 : value;
  }
  if (typeof value !== "object" || active.has(value)) fail("invalid_style_data", "Style/source/render data must be acyclic JSON");
  const data = descriptors(value), array = Array.isArray(value);
  active.add(value);
  try {
    if (array) {
      const length: unknown = data.length?.value;
      if (typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > budget.array ||
        Object.keys(data).length !== length + 1) fail("invalid_style_data", "Arrays must be dense bounded data without extra properties");
      return Array.from({ length }, (_, index) => {
        const descriptor = data[String(index)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail("invalid_style_data", "Array holes and accessors are forbidden");
        return jsonCopy(descriptor.value, budget, depth + 1, active);
      });
    }
    const keys = Object.keys(data).sort();
    if (keys.length > 2048) fail("style_data_limit", "A style/source/render object has too many fields");
    const result: Array<[string, Json]> = [];
    for (const key of keys) {
      const descriptor = data[key]!;
      if (key.length > budget.string || (budget.text -= key.length) < 0) fail("style_data_limit", "Object keys exceed the text bound");
      if (!descriptor.enumerable || !("value" in descriptor)) fail("invalid_style_data", "Object accessors and non-data fields are forbidden");
      if (descriptor.value === undefined && budget.omitUndefined) continue;
      result.push([key, jsonCopy(descriptor.value, budget, depth + 1, active)]);
    }
    return Object.fromEntries(result);
  } finally { active.delete(value); }
}
function canonical(value: unknown): string {
  return JSON.stringify(jsonCopy(value, { nodes: 600_000, text: 67_108_864, array: 32_768, string: 16_777_216, omitUndefined: false }));
}
function sourceSnapshot(raw: unknown): Json {
  const input = fields(raw, ["question", "turnPlan", "problemIR", "imageWidth", "imageHeight"]);
  return jsonCopy(input, { nodes: 40_000, text: 524_288, array: 2048, string: 16_384, omitUndefined: true });
}
function styleRequest(raw: unknown): ScientificStyle {
  const input = fields(raw, ["schema", "paletteId"]);
  const palette = SCIENTIFIC_STYLE_PALETTES.find(item => item.paletteId === input.paletteId);
  if (input.schema !== SCIENTIFIC_STYLE_SCHEMA || !palette) {
    fail("invalid_style_input", "Style must specify scientific-style/v1 and one fixed engine palette id");
  }
  return { schema: SCIENTIFIC_STYLE_SCHEMA, paletteId: palette.paletteId };
}
const xml = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function boardSvg(guide: GeneratedSceneGuide, imageSvg: string, complete: boolean): string {
  const matrix = guide.transform.imageToBoard;
  const labels = guide.labelSlots.filter(slot => complete || slot.revealAfter === "setup").map(slot => {
    const paths = textToStrokePathsSync(slot.text, slot.board.glyphOrigin.x, slot.board.glyphOrigin.y, slot.fontPx)
      .flatMap(character => character.strokes.map(stroke => '<path d="' + xml(stroke.pathData) + '" fill="none" stroke="#000" stroke-width="' + stroke.width + '" stroke-linecap="round" stroke-linejoin="round"/>')).join("");
    return '<g data-label-slot="' + xml(slot.id) + '" data-font-px="24" data-reveal-after="' + slot.revealAfter + '">' + paths + '</g>';
  }).join("");
  const affine = [matrix.xx, matrix.yx, matrix.xy, matrix.yy, matrix.tx, matrix.ty].join(" ");
  const caption = guide.caption && (complete || guide.caption.revealAfter === "setup")
    ? '<g data-scene-caption="' + guide.caption.revealAfter + '" data-caption-text="' + xml(guide.caption.text) + '">' +
      guide.caption.board.lines.flatMap(line => textToStrokePathsSync(line.text, line.glyphOrigin.x, line.glyphOrigin.y, guide.caption!.fontPx)
        .flatMap(character => character.strokes.map(stroke => '<path d="' + xml(stroke.pathData) + '" fill="none" stroke="#000" stroke-width="' + stroke.width + '" stroke-linecap="round" stroke-linejoin="round"/>'))).join("") + '</g>' : "";
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="#fff"/><g transform="matrix(' + affine + ')">' + imageSvg + '</g>' + labels + caption + '</svg>';
}
function renderGuide(guide: GeneratedSceneGuide, style: ScientificStyle): GeneratedSceneStyleRender {
  const palette = SCIENTIFIC_STYLE_PALETTES.find(item => item.paletteId === style.paletteId)!;
  // These literal attributes come only from imageSvg in the native guide. No
  // path, radius, width, dash, point marker, white background or empty fill changes.
  const svg = guide.image.svg.replaceAll('stroke="#000"', 'stroke="' + palette.ink + '"')
    .replaceAll('fill="#000"', 'fill="' + palette.ink + '"')
    .replaceAll('fill="#dcecf1"', 'fill="' + palette.regionFill + '"');
  const frame: StyleRenderData["frame"] = { width: 1200, height: 700, pictureBounds: { ...guide.transform.pictureBounds },
    setupSvg: boardSvg(guide, svg, false), completeDiagnosticSvg: boardSvg(guide, svg, true) };
  const data: StyleRenderData = {
    schema: GENERATED_SCENE_STYLE_SCHEMA, purpose: "native_geometry_cosmetic_style", accepted: false, automaticAdmission: false,
    style, guide, image: { width: guide.image.width, height: guide.image.height, svg }, frame,
    versions: { engine: SCENE_ENGINE_VERSION, source: "generated-scene-guide-source/v1", guide: GENERATED_SCENE_GUIDE_SCHEMA,
      style: SCIENTIFIC_STYLE_SCHEMA, palettes: PALETTES_VERSION, frame: FRAME_SCHEMA },
    sourcePayload: guide.sourcePayload, guidePayload: guide.guidePayload,
    stylePayload: canonical({ schema: PALETTES_VERSION, style, palette }),
    framePayload: canonical({ schema: FRAME_SCHEMA, frame, nativeTransform: guide.transform,
      guideImage: { width: guide.image.width, height: guide.image.height } }),
    renderPayload: "",
  };
  data.renderPayload = canonical(Object.fromEntries(Object.entries(data).filter(([key]) => key !== "renderPayload")));
  return freeze(data);
}
function decline(error: unknown): GeneratedSceneStyleCompileResult {
  return freeze({ ok: false, accepted: false, automaticAdmission: false, decline: {
    code: error instanceof StyleDecline ? error.code : "style_native_render_failed",
    message: error instanceof StyleDecline ? error.message : "Complete native scene styling could not be proved",
    entityIds: [],
  } });
}

/** Synchronous source replay plus fixed palette paint; never AI geometry admission. */
export function compileGeneratedSceneStyle(raw: unknown): GeneratedSceneStyleCompileResult {
  try {
    const input = fields(raw, ["sourceInput", "style"]), style = styleRequest(input.style);
    const rebuilt = compileGeneratedSceneGuide(sourceSnapshot(input.sourceInput));
    if (!rebuilt.ok) return rebuilt;
    return freeze({ ok: true, accepted: false, automaticAdmission: false, render: renderGuide(rebuilt.guide, style) });
  } catch (error) { return decline(error); }
}

/** Rebuild and compare ALL content and extra fields; caller hashes prove nothing. */
export function verifyGeneratedSceneStyle(raw: { sourceInput: unknown; style: unknown; render: unknown }): GeneratedSceneStyleVerificationResult {
  try {
    const input = fields(raw, ["sourceInput", "style", "render"]);
    const submitted = canonical(input.render);
    const expected = compileGeneratedSceneStyle({ sourceInput: input.sourceInput, style: input.style });
    if (!expected.ok) return expected;
    if (submitted !== canonical(expected.render)) fail("style_replay_mismatch", "Styled render differs from the complete fresh source and palette reconstruction");
    return expected;
  } catch (error) { return decline(error); }
}
