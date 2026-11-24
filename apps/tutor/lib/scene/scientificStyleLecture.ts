import { SCIENTIFIC_STYLE_PALETTES, type ScientificStylePaletteId, type SceneDocument } from "@heytutor/scene-engine";
import type { DrawCommand, DrawCommandInkSettings, VerifiedDiagramPresentation } from "@heytutor/drawing";

export const SCIENTIFIC_STYLE_LECTURE_POLICY = "source-proved-native-style-lecture/v1" as const;
export interface ScientificStyleLecture {
  schema: "scientific-style-lecture/v1";
  paletteId: ScientificStylePaletteId;
  sampleHash: string;
}

export function parseScientificStyleLecture(raw: unknown): ScientificStyleLecture | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  if (Object.keys(item).length !== 3 || item.schema !== "scientific-style-lecture/v1" ||
      !SCIENTIFIC_STYLE_PALETTES.some(palette => palette.paletteId === item.paletteId) ||
      typeof item.sampleHash !== "string" || !/^[a-f0-9]{64}$/u.test(item.sampleHash)) return null;
  return { schema: "scientific-style-lecture/v1", paletteId: item.paletteId as ScientificStylePaletteId, sampleHash: item.sampleHash };
}

/** Submitted source metadata cannot choose a palette or prove sample provenance. */
export function bindScientificStyleSource(raw: unknown, trusted: ScientificStyleLecture | null | undefined): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const document = raw as Record<string, unknown>;
  if (!document.source || typeof document.source !== "object" || Array.isArray(document.source)) return raw;
  const source = document.source as Record<string, unknown>;
  if (!Object.hasOwn(source, "scientificStyle")) return raw;
  const submitted = parseScientificStyleLecture(source.scientificStyle);
  const bound = submitted && trusted && submitted.paletteId === trusted.paletteId && submitted.sampleHash === trusted.sampleHash;
  const next = { ...source };
  delete next.scientificStyle;
  return { ...document, source: { ...next, ...(bound ? { scientificStyle: { ...trusted } } : {}) } };
}

export function applyScientificStyleToPresentation(presentation: VerifiedDiagramPresentation, raw: unknown): void {
  const style = parseScientificStyleLecture(raw);
  if (!style || presentation.diagram.id !== "verified_scene") return;
  // The source compiler already owns every mark and all label timing. Paint
  // existing native geometry only; labels, work ink and focus traces stay as-is.
  const paint = (command: Pick<DrawCommand, "type" | "visualStyle">) => {
    if ((command.type.startsWith("DRAW_") && command.type !== "DRAW_PICTURE" || command.type === "ARROW" ||
        command.type === "DIMENSION" || command.type === "HIGHLIGHT") && command.visualStyle?.strokeRole !== "trace") {
      command.visualStyle = { ...command.visualStyle, scientificPalette: style.paletteId };
    }
  };
  presentation.diagram.commands.forEach(paint);
  presentation.diagram.deferredAnnotations?.forEach(entry => entry.commands.forEach(paint));
  presentation.introSegments.forEach(segment => {
    if (segment.command) paint(segment.command);
    segment.commands?.forEach(paint);
  });
}

/** Add cosmetic provenance only after the ordinary source/save selection. */
export function withScientificStyleNativeRepresentation<T extends { figureSource: string; sceneDocument: SceneDocument }>(
  selected: T | null, raw: unknown,
): T | null {
  const style = parseScientificStyleLecture(raw);
  return selected?.figureSource === "native_source" && style
    ? { ...selected, sceneDocument: { ...selected.sceneDocument, source: { ...selected.sceneDocument.source, scientificStyle: style } } }
    : selected;
}

export function scientificCommandPalette(command: Pick<DrawCommand, "visualStyle">) {
  return SCIENTIFIC_STYLE_PALETTES.find(palette => palette.paletteId === command.visualStyle?.scientificPalette);
}

export function prepareScientificCommandInk(command: DrawCommand, current: DrawCommandInkSettings): void {
  const palette = scientificCommandPalette(command);
  if (palette && !command.inkSettings) command.inkSettings = { ...current, pencilColor: palette.ink };
}
