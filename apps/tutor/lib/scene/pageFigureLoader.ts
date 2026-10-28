/**
 * The figure a saved doubt pointed at, loaded on the server.
 *
 * A doubt is saved without a scene of its own; `sceneArtifacts.pointsAtFigure`
 * names the earlier turn whose figure was in the zone while it taught. The
 * browser's claim is never authority: this loader rebuilds that figure from the
 * referenced turn's own stored row, and only when the reference really names a
 * figure on the page the doubt continues. Anything else resolves null, and the
 * save keeps the doubt's words and drops its pointing.
 *
 * The rules, all required:
 * 1. The referenced turn is on the same board, owned by the same user, and
 *    comes before the doubt (before the next index when the doubt has no row).
 * 2. Every turn strictly between the two continues the board: no page opener.
 * 3. The referenced turn's page question is the doubt's lesson question.
 * 4. The referenced row holds a figure of the kind the reference claims.
 */
import {
  type ReferencePictureRecord,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import {
  storedTurnContinuesBoard,
  storedTurnPageQuestion,
} from "@/lib/boards/boardContinuation";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import type { DoubtFigureRef } from "@/lib/boards/doubtFigureRef";
import { parseStoredCodeLesson } from "@/lib/code-lesson/persistedCodeLesson";
import { restoreVerifiedPresentationFromTurn } from "@/features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { resolveDsaFrames } from "@/features/tutor-session/lib/code-lesson/dsaFrames";
import {
  buildReferencePicturePresentation,
  readStoredReferencePicture,
  referencePictureIdOf,
} from "@/features/tutor-session/lib/scene/referencePicturePresentation";
import type { ReferencePictureLoader } from "@/lib/scene/referencePicturePersistence";

/** What the doubt being saved says about its page. */
export interface PageFigureRequest {
  /** `boardContinuation.lessonQuestion` of the doubt. */
  lessonQuestion: string;
}

/** Bound by the save route to the doubt's board, owner and turn id. */
export type PageFigureLoader = (ref: DoubtFigureRef, page: PageFigureRequest) => Promise<VerifiedDiagram | null>;

/** The stored fields the rules read. */
export interface PageFigureTurn {
  id: string;
  boardId: string;
  userId: string;
  orderIndex: number;
  question: string;
  visualStatus: string | null;
  sceneDocument: unknown;
  sceneArtifacts: unknown;
  /** At least the first segment by orderIndex: it says whether the turn opened a page. */
  segments: { orderIndex: number; command: unknown }[];
}

/** A page this long is not one a doubt points across; a longer read resolves null. */
export const PAGE_FIGURE_MAX_TURNS_BETWEEN = 200;

/** Reads behind the loader; the route binds Prisma, gates bind memory. */
export interface PageFigureStore {
  findTurn(id: string): Promise<PageFigureTurn | null>;
  /**
   * Turns on the board, any owner, with `after < orderIndex` (and `< before`
   * when given), in board order, at most `PAGE_FIGURE_MAX_TURNS_BETWEEN + 1`.
   */
  turnsBetween(boardId: string, after: number, before: number | null): Promise<PageFigureTurn[]>;
}

export interface PageFigureContext {
  boardId: string;
  userId: string;
  /** The doubt's own checkpoint id. Null or unknown when it has no row yet. */
  turnId: string | null;
}

/** The continuation reads only the marker and the first segment. */
function asContinuationTurn(turn: PageFigureTurn): Pick<StoredTurn, "question" | "sceneArtifacts" | "segments"> {
  return turn as unknown as Pick<StoredTurn, "question" | "sceneArtifacts" | "segments">;
}

function normalizedQuestion(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 4_000);
}

async function pictureFigure(
  turn: PageFigureTurn,
  loadReferencePicture: ReferencePictureLoader | undefined,
): Promise<VerifiedDiagram | null> {
  const id = referencePictureIdOf(turn.sceneArtifacts);
  const stored = id ? readStoredReferencePicture(turn.sceneArtifacts) : null;
  if (!id || !stored || stored.id !== id) return null;
  let record: ReferencePictureRecord | null = null;
  try {
    const loader = loadReferencePicture
      ?? (await import("@/lib/scene/referencePicturePersistence")).loadStoredReferencePicture;
    const loaded = await loader(id);
    record = loaded && loaded.id === id ? loaded : null;
  } catch {
    record = null;
  }
  if (!record) return null;
  try {
    // The production loader strips parts when this server's part focus is off,
    // so the pointables match what a picture turn saved today would keep.
    return buildReferencePicturePresentation(record, { partFocus: record.parts !== undefined }).diagram;
  } catch {
    return null;
  }
}

function sceneFigure(turn: PageFigureTurn): VerifiedDiagram | null {
  if (turn.visualStatus !== "validated") return null;
  const presentation = restoreVerifiedPresentationFromTurn({
    question: turn.question,
    sceneDocument: turn.sceneDocument,
    sceneArtifacts: turn.sceneArtifacts,
  });
  if (!presentation || presentation.diagram.layout === "code_lesson") return null;
  return presentation.diagram;
}

function dsaFrameFigure(turn: PageFigureTurn, frameIndex: number | undefined): VerifiedDiagram | null {
  if (turn.visualStatus !== "validated" || frameIndex === undefined) return null;
  const presentation = restoreVerifiedPresentationFromTurn({
    question: turn.question,
    sceneDocument: turn.sceneDocument,
    sceneArtifacts: turn.sceneArtifacts,
  });
  if (!presentation || presentation.diagram.layout !== "code_lesson") return null;
  const codeLesson = parseStoredCodeLesson(turn.sceneArtifacts, turn.question);
  if (codeLesson.status !== "valid") return null;
  let frames;
  try {
    frames = resolveDsaFrames(turn.question, codeLesson.plan.diagramHint, codeLesson.plan)?.frames ?? null;
  } catch {
    return null;
  }
  return frames?.[frameIndex]?.presentation.diagram ?? null;
}

/**
 * The loader for one doubt save. Never throws: any failure is null, and null
 * only ever costs the doubt its pointing.
 */
export function bindPageFigureLoader(
  context: PageFigureContext,
  deps: { store: PageFigureStore; loadReferencePicture?: ReferencePictureLoader },
): PageFigureLoader {
  return async (ref, page) => {
    try {
      const target = await deps.store.findTurn(ref.turnId);
      if (!target || target.boardId !== context.boardId || target.userId !== context.userId) return null;
      if (ref.turnId === context.turnId) return null;
      const self = context.turnId ? await deps.store.findTurn(context.turnId) : null;
      const doubtRow = self && self.boardId === context.boardId && self.userId === context.userId ? self : null;
      if (doubtRow && doubtRow.orderIndex <= target.orderIndex) return null;
      const between = (await deps.store.turnsBetween(context.boardId, target.orderIndex, doubtRow?.orderIndex ?? null))
        .filter((turn) => turn.id !== context.turnId);
      if (between.length > PAGE_FIGURE_MAX_TURNS_BETWEEN) return null;
      if (between.some((turn) => !storedTurnContinuesBoard(asContinuationTurn(turn)))) return null;
      const pageQuestion = storedTurnPageQuestion(asContinuationTurn(target));
      if (normalizedQuestion(pageQuestion) !== normalizedQuestion(page.lessonQuestion)) return null;
      if (ref.kind === "verified_scene") return sceneFigure(target);
      if (ref.kind === "dsa_frame") return dsaFrameFigure(target, ref.frameIndex);
      return await pictureFigure(target, deps.loadReferencePicture);
    } catch {
      return null;
    }
  };
}

const PAGE_FIGURE_TURN_SELECT = {
  id: true,
  boardId: true,
  userId: true,
  orderIndex: true,
  question: true,
  visualStatus: true,
  sceneDocument: true,
  sceneArtifacts: true,
  segments: { select: { orderIndex: true, command: true }, orderBy: { orderIndex: "asc" as const }, take: 1 },
} as const;

/** The Prisma reads, for the save routes. */
export function prismaPageFigureStore(db: {
  turn: {
    findFirst(args: { where: { id: string }; select: typeof PAGE_FIGURE_TURN_SELECT }): Promise<unknown>;
    findMany(args: {
      where: { boardId: string; orderIndex: { gt: number; lt?: number } };
      select: typeof PAGE_FIGURE_TURN_SELECT;
      orderBy: { orderIndex: "asc" };
      take: number;
    }): Promise<unknown[]>;
  };
}): PageFigureStore {
  return {
    findTurn: async (id) =>
      (await db.turn.findFirst({ where: { id }, select: PAGE_FIGURE_TURN_SELECT })) as PageFigureTurn | null,
    turnsBetween: async (boardId, after, before) =>
      (await db.turn.findMany({
        where: { boardId, orderIndex: before === null ? { gt: after } : { gt: after, lt: before } },
        select: PAGE_FIGURE_TURN_SELECT,
        orderBy: { orderIndex: "asc" },
        take: PAGE_FIGURE_MAX_TURNS_BETWEEN + 1,
      })) as PageFigureTurn[],
  };
}

/** The production binding for one save: Prisma reads and the stored picture loader. */
export function pageFigureLoaderFor(
  context: PageFigureContext,
  db: Parameters<typeof prismaPageFigureStore>[0],
): PageFigureLoader {
  return bindPageFigureLoader(context, { store: prismaPageFigureStore(db) });
}
