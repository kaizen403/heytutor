/**
 * The reference picture branch of turn persistence.
 *
 * A picture turn is saved text only for the verified engine (no scene, its
 * figure source and result status unchanged) and keeps two trusted
 * `DRAW_PICTURE` rows. Their ink is never the browser's: the server loads the
 * stored record for the turn's picture id and rebuilds both passes from it,
 * exactly as `mergeServerDiagramIntro` rebuilds a scene intro from the scene
 * document. A missing record, a forged id, or any other trusted ink on a
 * picture turn loses its ink and keeps its words. Nothing here fails a save.
 */
import {
  getSegmentCommands,
  isStoredCommandTrustedGeometry,
  parsePictureCommandParams,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
  type ReferencePictureRecord,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import {
  buildReferencePicturePresentation,
  isReferencePictureRow,
  pointsAtReferencePicture,
  readReferencePictureOutcome,
  referencePictureIdOf,
  type ReferencePictureOutcome,
  type StoredReferencePicture,
} from "@/features/tutor-session/lib/scene/referencePicturePresentation";

export type ReferencePictureLoader = (id: string) => Promise<ReferencePictureRecord | null>;

/**
 * The production loader. Imported lazily so the scene validator, which every
 * save and many verify scripts load, does not pull the database client in for
 * the turns that carry no picture.
 */
export const loadStoredReferencePicture: ReferencePictureLoader = async (id) => {
  // With the tier off no record resolves, so a client cannot save picture ink
  // the server would not have drawn: the rows keep their words, lose the ink.
  const { resolveReferencePictureEnabled, resolveReferencePicturePartFocusEnabled } = await import("@/lib/scene/diagramStrategy.server");
  if (!resolveReferencePictureEnabled()) return null;
  const { loadReferencePictureRecord } = await import("@/lib/reference-picture/pictureStore");
  const record = await loadReferencePictureRecord(id);
  return record ? recordForPartFocus(record, resolveReferencePicturePartFocusEnabled()) : null;
};

/** Part focus off: the record without its parts, so a save sees it exactly as before parts existed. */
export function recordForPartFocus(record: ReferencePictureRecord, partFocus: boolean): ReferencePictureRecord {
  if (partFocus || record.parts === undefined) return record;
  const withoutParts = { ...record };
  delete withoutParts.parts;
  return withoutParts;
}

/** Whether this server points at a picture's parts (`REFERENCE_PICTURE_PART_FOCUS`). */
async function partFocusEnabled(): Promise<boolean> {
  const { resolveReferencePicturePartFocusEnabled } = await import("@/lib/scene/diagramStrategy.server");
  return resolveReferencePicturePartFocusEnabled();
}

/**
 * For the checkpoint route: a text only scene that claims a picture keeps its
 * rows unstripped, so this branch can rebuild the picture's passes from the
 * record instead of losing them to the scene ink strip.
 */
export function sceneKeepsReferencePictureRows(sceneArtifacts: unknown): boolean {
  return referencePictureIdOf(sceneArtifacts) !== null;
}

/** Pointing that names scene parts. A picture turn keeps only FOCUS on the picture or, with part focus, on its parts. */
const SCENE_POINTING = new Set<DrawCommand["type"]>(["POINT", "FOCUS", "FRAME", "ANNOTATE"]);

interface PictureRow {
  orderIndex: number;
  narration: string;
  spokenText: string;
  command: unknown;
}

export interface CanonicalReferencePictureRows<Row extends PictureRow> {
  segments: Row[];
  /**
   * The record's diagram, for the teaching FOCUS filter: set whenever the
   * server holds the record, so a resume under a picture an earlier turn drew
   * keeps its FOCUS on it. FOCUS draws nothing, so this grants no ink.
   */
  diagram: VerifiedDiagram | null;
  /** The server's own summary for `sceneArtifacts.referencePicture`, only when ink was kept. */
  stored: StoredReferencePicture | null;
}

function words(row: PictureRow): boolean {
  return Boolean(row.narration.trim() || row.spokenText.trim());
}

/**
 * Rebuild or strip picture ink. `record` is the server's record for the id
 * the artifacts claim (null when there is none, or none was found).
 * `pictureTurn` is true when the artifacts claim a picture at all: then every
 * other trusted row loses its ink and scene pointing is dropped, since a
 * picture turn has no scene for either. Untrusted `DRAW_PICTURE` (it is
 * runtime only, so the model never wrote one) is always dropped.
 */
export function canonicalReferencePictureRows<Row extends PictureRow>(
  segments: readonly Row[],
  record: ReferencePictureRecord | null,
  options: { pictureTurn: boolean; partFocus?: boolean },
): CanonicalReferencePictureRows<Row> {
  // The passes are rebuilt in the voice they were recorded in, so each keeps
  // the cue word its own sentence says (as the scene intro rebuild does).
  const hinglish = segments.some((row) => isReferencePictureRow(row.command) && /\p{Script=Devanagari}/u.test(row.narration));
  let presentation: ReturnType<typeof buildReferencePicturePresentation> | null = null;
  if (record) {
    try {
      // Part and key targets come from this record and this server's flag,
      // never from the browser's artifact: a FOCUS is kept only on a target
      // the server itself would offer.
      presentation = buildReferencePicturePresentation(record, {
        ...(hinglish ? { narrationLanguage: "hinglish" as const } : {}),
        partFocus: options.partFocus === true,
      });
    } catch {
      presentation = null;
    }
  }
  const serverPass = new Map<string, DrawCommand>();
  for (const segment of presentation?.introSegments ?? []) {
    for (const command of getSegmentCommands(segment)) {
      const pass = parsePictureCommandParams(command.params)?.pass;
      if (pass) serverPass.set(pass, command);
    }
  }
  const used = new Set<string>();
  const kept: Row[] = [];
  let pictureInk = false;
  for (const row of segments) {
    if (isStoredCommandTrustedGeometry(row.command)) {
      if (isReferencePictureRow(row.command)) {
        const rebuilt = parseStoredSegmentCommands(row.command).flatMap((command) => {
          const pass = command.text === record?.id && Array.isArray(command.params)
            ? parsePictureCommandParams(command.params)?.pass : undefined;
          const server = pass && !used.has(pass) ? serverPass.get(pass) : undefined;
          if (!pass || !server) return [];
          used.add(pass);
          return [{ ...server, params: [...server.params], ...(server.spokenCue ? { spokenCue: { ...server.spokenCue } } : {}) }];
        });
        if (rebuilt.length > 0) {
          pictureInk = true;
          kept.push({ ...row, command: serializeSegmentCommands(rebuilt, { trustedDiagramGeometry: true }) });
        } else if (words(row)) {
          // Another id, a repeated pass, or no record: the words stay, the ink goes.
          kept.push({ ...row, command: null });
        }
        continue;
      }
      if (options.pictureTurn) {
        if (words(row)) kept.push({ ...row, command: null });
        continue;
      }
      kept.push(row);
      continue;
    }
    if (row.command == null) {
      kept.push(row);
      continue;
    }
    const commands = parseStoredSegmentCommands(row.command);
    const allowed = commands.filter((command) => command?.type !== "DRAW_PICTURE" && !(
      options.pictureTurn && SCENE_POINTING.has(command.type) && !(presentation && pointsAtReferencePicture(command, presentation.diagram))
    ));
    if (allowed.length === commands.length) {
      kept.push(row);
      continue;
    }
    if (allowed.length === 0 && !words(row)) continue;
    kept.push({ ...row, command: allowed.length > 0 ? serializeSegmentCommands(allowed) : null });
  }
  const shown = Boolean(presentation && pictureInk);
  return {
    segments: kept,
    diagram: presentation?.diagram ?? null,
    stored: shown ? presentation!.stored : null,
  };
}

/**
 * Load the record a turn claims (never throwing) and canonicalize its rows.
 * `partFocus` defaults to this server's flag.
 */
export async function canonicalizeReferencePictureTurn<Row extends PictureRow>(
  segments: readonly Row[],
  sceneArtifacts: unknown,
  loader: ReferencePictureLoader = loadStoredReferencePicture,
  partFocus?: boolean,
): Promise<CanonicalReferencePictureRows<Row> & { outcome: ReferencePictureOutcome | null }> {
  const id = referencePictureIdOf(sceneArtifacts);
  let record: ReferencePictureRecord | null = null;
  if (id) {
    try {
      const loaded = await loader(id);
      record = loaded && loaded.id === id ? loaded : null;
    } catch {
      record = null;
    }
  }
  const rows = canonicalReferencePictureRows(segments, record, {
    pictureTurn: id !== null,
    partFocus: record ? partFocus ?? await partFocusEnabled() : false,
  });
  // The browser's account of its own attempt, kept as telemetry only. Whether
  // a picture was saved is `referencePicture`, which only the server writes.
  // A resume inherits its lesson's outcome; count outcomes on lesson turns.
  return { ...rows, outcome: readReferencePictureOutcome(sceneArtifacts) };
}
