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
 * 5. On a lesson with later figures (DIAGRAM_LESSON_FIGURES), the figure named
 *    is the one the stored page had reached: `pageFigureAt` over the page's
 *    stored turns, with the doubt appended, puts that turn and that figure in
 *    the zone (`storedPageZone`).
 *
 * A doubt that drew its own figure (`doubtFigure.ts`) is checked against the
 * same page by `bindDoubtFigurePageCheck`: the page the doubt continues opens
 * on a turn of the doubt's lesson question, and the figure the marker says it
 * replaced is a figure on that page.
 */
import {
  type ReferencePictureRecord,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import {
  BOARD_CONTINUATION_VERSION,
  storedTurnContinuesBoard,
  storedTurnPageQuestion,
} from "@/lib/boards/boardContinuation";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import type { DoubtFigureRef } from "@/lib/boards/doubtFigureRef";
import { doubtFigureOf, storedTurnSceneQuestion, type DoubtFigureMarker } from "@/lib/boards/doubtFigure";
import { LESSON_FIGURES_VERSION, lessonFiguresOf, type LessonFigureId } from "@/lib/boards/lessonFigures";
import { pageFigureAt, type PageFigureAt, type PageFigureId, type PageFigureTurn as ZoneTurn } from "@/lib/boards/pageFigure";
import { admitLessonFigures } from "@/lib/scene/sceneAdmission";
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
  /**
   * DIAGRAM_LESSON_FIGURES at save time, set only when on. A lesson with later
   * figures may have moved past figure 1, so the figure named must be the one
   * the stored page had reached (`pageFigureAt`).
   */
  lessonFigures?: true;
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
  /** The turn's kind; read by the zone walk only (`pageTurns`). */
  kind?: string | null;
}

/** A page turn as the zone walk reads it: every row's command, the kind, the status. No scene document. */
export type PageZoneTurn = Pick<PageFigureTurn, "id" | "boardId" | "userId" | "orderIndex" | "question" | "visualStatus" | "sceneArtifacts" | "segments" | "kind">;

/** The fields the page walk reads: whether each turn continues the page, and its question. */
export type PageWalkTurn = Pick<PageFigureTurn, "id" | "boardId" | "userId" | "orderIndex" | "question" | "sceneArtifacts" | "segments">;

/** A page this long is not one a doubt points across; a longer read resolves null. */
export const PAGE_FIGURE_MAX_TURNS_BETWEEN = 200;

/** Reads behind the loader; the route binds Prisma, gates bind memory. */
export interface PageFigureStore {
  findTurn(id: string): Promise<PageFigureTurn | null>;
  /**
   * Turns on the board, any owner, with `after < orderIndex` (and `< before`
   * when given), in board order, at most `PAGE_FIGURE_MAX_TURNS_BETWEEN + 1`.
   */
  turnsBetween(boardId: string, after: number, before: number | null): Promise<PageWalkTurn[]>;
  /**
   * Turns on the board, any owner, with `orderIndex < before` (every turn
   * when null), newest first, at most `PAGE_FIGURE_MAX_TURNS_BETWEEN + 2`.
   */
  turnsBefore(boardId: string, before: number | null): Promise<PageWalkTurn[]>;
  /**
   * Turns on the board, any owner, with `from <= orderIndex` (and `< before`
   * when given), in board order, with every row, at most
   * `PAGE_FIGURE_MAX_TURNS_BETWEEN + 2`. Absent, no zone walk can run and a
   * figure that needs one is refused.
   */
  pageTurns?(boardId: string, from: number, before: number | null): Promise<PageZoneTurn[]>;
}

export interface PageFigureContext {
  boardId: string;
  userId: string;
  /** The doubt's own checkpoint id. Null or unknown when it has no row yet. */
  turnId: string | null;
}

/** The continuation reads only the marker and the first segment. */
function asContinuationTurn(turn: PageWalkTurn): Pick<StoredTurn, "question" | "sceneArtifacts" | "segments"> {
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

/**
 * A lesson's later figure (DIAGRAM_LESSON_FIGURES), rebuilt from the
 * referenced turn's own stored artifact exactly as the save admitted it
 * (`admitLessonFigures`): on the lesson question composed with its view, with
 * the lesson's plan restamped to that question. The doubt only names the id;
 * an id the stored artifact does not list, or a figure that no longer admits,
 * is null.
 */
function lessonFigure(turn: PageFigureTurn, figureId: LessonFigureId): VerifiedDiagram | null {
  if (turn.visualStatus !== "validated") return null;
  const figure = lessonFiguresOf(turn.sceneArtifacts)?.figures.find((candidate) => candidate.id === figureId);
  if (!figure) return null;
  const lessonQuestion = storedTurnSceneQuestion(turn);
  if (typeof lessonQuestion !== "string" || !lessonQuestion.trim()) return null;
  const lessonPlan = turn.sceneArtifacts && typeof turn.sceneArtifacts === "object"
    ? Object.getOwnPropertyDescriptor(turn.sceneArtifacts, "turnPlan")?.value
    : undefined;
  const admitted = admitLessonFigures(
    { schemaVersion: LESSON_FIGURES_VERSION, figures: [figure] },
    { lessonQuestion, lessonPlan },
  );
  return admitted.diagrams.get(figure.id) ?? null;
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
 * The zone a turn appended after the stored page's last turn starts on: the
 * same `pageFigureAt` replay, restore and export run, over the page's stored
 * turns (the saved turn's own row excluded) with `next` appended. `turnIds`
 * maps the walk's indexes to turn ids. Null when the page cannot be read.
 *
 * A validated row always stores its scene document (the canonicalizer writes
 * one), so the walk reads the status and never loads the documents.
 */
export async function storedPageZone(
  context: PageFigureContext,
  store: PageFigureStore,
  next: { kind: "doubt" | "resume" },
): Promise<{ turnIds: string[]; at: PageFigureAt } | null> {
  if (!store.pageTurns) return null;
  const self = context.turnId ? await store.findTurn(context.turnId) : null;
  if (self && (self.boardId !== context.boardId || self.userId !== context.userId)) return null;
  const before = self?.orderIndex ?? null;
  const earlier = (await store.turnsBefore(context.boardId, before)).filter((turn) => turn.id !== context.turnId);
  let opener: PageWalkTurn | null = null;
  for (const [index, turn] of earlier.entries()) {
    if (index > PAGE_FIGURE_MAX_TURNS_BETWEEN) return null;
    if (!storedTurnContinuesBoard(asContinuationTurn(turn))) {
      opener = turn;
      break;
    }
  }
  // Every stored turn continues the board: the oldest one opened it.
  if (!opener) {
    if (earlier.length > PAGE_FIGURE_MAX_TURNS_BETWEEN) return null;
    opener = earlier.at(-1) ?? null;
  }
  if (!opener) return null;
  const page = (await store.pageTurns(context.boardId, opener.orderIndex, before))
    .filter((turn) => turn.id !== context.turnId && turn.boardId === context.boardId);
  if (page.length === 0 || page.length > PAGE_FIGURE_MAX_TURNS_BETWEEN + 1 || page[0]!.id !== opener.id) return null;
  const turns: ZoneTurn[] = page.map((turn) => ({
    kind: (turn.kind ?? undefined) as ZoneTurn["kind"],
    sceneArtifacts: turn.sceneArtifacts as ZoneTurn["sceneArtifacts"],
    segments: turn.segments as unknown as ZoneTurn["segments"],
    sceneDocument: turn.visualStatus === "validated" ? {} as ZoneTurn["sceneDocument"] : null,
    visualStatus: turn.visualStatus as ZoneTurn["visualStatus"],
  }));
  turns.push({
    kind: next.kind,
    sceneArtifacts: { boardContinuation: { schemaVersion: BOARD_CONTINUATION_VERSION, lessonQuestion: "" } } as ZoneTurn["sceneArtifacts"],
    segments: [],
    sceneDocument: null,
    visualStatus: "text_only",
  });
  return { turnIds: page.map((turn) => turn.id), at: pageFigureAt(turns, turns.length - 1) };
}

/**
 * Which of the lesson's figures a resume saved now starts on: the figure the
 * stored page had reached (`pageFigureAt` with a resume appended), so its
 * teaching is checked against the figure live taught it on. Bound by the save
 * route; "figure_1" when the page cannot be read or no turn lists later figures.
 */
export type LessonFigureStartLoader = () => Promise<PageFigureId>;

export function bindLessonFigureStart(
  context: PageFigureContext,
  deps: { store: PageFigureStore },
): LessonFigureStartLoader {
  return async () => {
    try {
      const self = context.turnId ? await deps.store.findTurn(context.turnId) : null;
      const earlier = await deps.store.turnsBefore(context.boardId, self?.orderIndex ?? null);
      // Most pages have no later figure: no full read for them.
      if (!earlier.some((turn) => turn.id !== context.turnId && lessonFiguresOf(turn.sceneArtifacts))) return "figure_1";
      const zone = await storedPageZone(context, deps.store, { kind: "resume" });
      return zone?.at.figureId ?? "figure_1";
    } catch {
      return "figure_1";
    }
  };
}

/**
 * Rebuilt figures by referenced turn. A doubt checkpoints many times against
 * the same lesson figure; its compile and presentation are reused while the
 * referenced row is unchanged (the fingerprint is the row's question, status
 * and scene), and every caller gets its own copy.
 */
const FIGURE_CACHE_LIMIT = 64;
const figureCache = new Map<string, { fingerprint: string; diagram: VerifiedDiagram | null }>();
const figureCacheStats = { builds: 0, hits: 0 };

/** Builds and hits of the figure cache, for the gates. */
export function pageFigureCacheStats(): { builds: number; hits: number } {
  return { ...figureCacheStats };
}

function cachedFigure(ref: DoubtFigureRef, turn: PageFigureTurn, build: () => VerifiedDiagram | null): VerifiedDiagram | null {
  const key = `${ref.kind}:${ref.frameIndex ?? ""}:${ref.figureId ?? ""}:${turn.id}`;
  const fingerprint = JSON.stringify([turn.question, turn.visualStatus, turn.sceneDocument, turn.sceneArtifacts]);
  const cached = figureCache.get(key);
  let diagram: VerifiedDiagram | null;
  if (cached && cached.fingerprint === fingerprint) {
    figureCacheStats.hits += 1;
    diagram = cached.diagram;
  } else {
    figureCacheStats.builds += 1;
    diagram = build();
    figureCache.delete(key);
    figureCache.set(key, { fingerprint, diagram });
    while (figureCache.size > FIGURE_CACHE_LIMIT) figureCache.delete(figureCache.keys().next().value!);
  }
  return diagram ? structuredClone(diagram) : null;
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
      if (ref.kind === "verified_scene") {
        const figureId = ref.figureId;
        // page-figure-reached:begin
        // A lesson with later figures: the figure named must be the one the
        // stored page had reached when the doubt was asked, on the turn named.
        if (figureId !== undefined || (page.lessonFigures === true && lessonFiguresOf(target.sceneArtifacts))) {
          const zone = await storedPageZone(context, deps.store, { kind: "doubt" });
          if (!zone || zone.at.sourceIndex === null || zone.turnIds[zone.at.sourceIndex] !== target.id) return null;
          if (zone.at.figureId !== (figureId ?? "figure_1")) return null;
        }
        // page-figure-reached:end
        return cachedFigure(ref, target, () => figureId ? lessonFigure(target, figureId) : sceneFigure(target));
      }
      if (ref.kind === "dsa_frame") return cachedFigure(ref, target, () => dsaFrameFigure(target, ref.frameIndex));
      return await pictureFigure(target, deps.loadReferencePicture);
    } catch {
      return null;
    }
  };
}

/** Whether a doubt that drew its own figure belongs to its page's lesson. */
export type DoubtFigurePageCheck = (marker: DoubtFigureMarker, page: PageFigureRequest) => Promise<boolean>;

/**
 * The page rules for a doubt figure, bound to one save. True only when:
 * 1. the newest turn before the doubt that opens a page (every turn after it
 *    continues the board) is the user's, and its page question is the
 *    doubt's lesson question;
 * 2. `replacedTurnId`, when set, is a turn on that page, the user's, with a
 *    validated scene or a reference picture of its own, and not itself a
 *    doubt figure (a doubt only ever stashes the lesson's figure).
 * Never throws: any failure is false.
 */
export function bindDoubtFigurePageCheck(
  context: PageFigureContext,
  deps: { store: PageFigureStore },
): DoubtFigurePageCheck {
  return async (marker, page) => {
    try {
      const self = context.turnId ? await deps.store.findTurn(context.turnId) : null;
      if (self && (self.boardId !== context.boardId || self.userId !== context.userId)) return false;
      const earlier = await deps.store.turnsBefore(context.boardId, self?.orderIndex ?? null);
      const continuing: PageWalkTurn[] = [];
      let opener: PageWalkTurn | null = null;
      for (const turn of earlier) {
        if (turn.id === context.turnId) continue;
        if (!storedTurnContinuesBoard(asContinuationTurn(turn))) {
          opener = turn;
          break;
        }
        continuing.push(turn);
        if (continuing.length > PAGE_FIGURE_MAX_TURNS_BETWEEN) return false;
      }
      if (!opener || opener.boardId !== context.boardId || opener.userId !== context.userId) return false;
      if (normalizedQuestion(storedTurnPageQuestion(asContinuationTurn(opener))) !== normalizedQuestion(page.lessonQuestion)) return false;
      if (marker.replacedTurnId === null) return true;
      if (![opener, ...continuing].some((turn) => turn.id === marker.replacedTurnId)) return false;
      const replaced = await deps.store.findTurn(marker.replacedTurnId);
      if (!replaced || replaced.boardId !== context.boardId || replaced.userId !== context.userId) return false;
      if (doubtFigureOf(replaced.sceneArtifacts)) return false;
      // A validated scene, or a reference picture (saved text only, its rows
      // rebuilt from the record on save): both are figures a resume returns.
      return (replaced.visualStatus === "validated" && replaced.sceneDocument != null) ||
        referencePictureIdOf(replaced.sceneArtifacts) !== null;
    } catch {
      return false;
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

/** The page walk: no scene document, which can be large, on each of up to 200 rows. */
const PAGE_WALK_TURN_SELECT = {
  id: true,
  boardId: true,
  userId: true,
  orderIndex: true,
  question: true,
  sceneArtifacts: true,
  segments: { select: { orderIndex: true, command: true }, orderBy: { orderIndex: "asc" as const }, take: 1 },
} as const;

/** The zone walk: every row's command and the kind, still no scene document. */
const PAGE_ZONE_TURN_SELECT = {
  id: true,
  boardId: true,
  userId: true,
  orderIndex: true,
  question: true,
  kind: true,
  visualStatus: true,
  sceneArtifacts: true,
  segments: { select: { orderIndex: true, command: true }, orderBy: { orderIndex: "asc" as const } },
} as const;

/** The same reads over rows in memory, for the gates. */
export function memoryPageFigureStore(turns: readonly PageFigureTurn[]): PageFigureStore {
  const sorted = [...turns].sort((a, b) => a.orderIndex - b.orderIndex);
  return {
    findTurn: async (id) => sorted.find((turn) => turn.id === id) ?? null,
    turnsBetween: async (boardId, after, before) => sorted
      .filter((turn) => turn.boardId === boardId && turn.orderIndex > after && (before === null || turn.orderIndex < before))
      .slice(0, PAGE_FIGURE_MAX_TURNS_BETWEEN + 1),
    turnsBefore: async (boardId, before) => sorted
      .filter((turn) => turn.boardId === boardId && (before === null || turn.orderIndex < before))
      .reverse()
      .slice(0, PAGE_FIGURE_MAX_TURNS_BETWEEN + 2),
    pageTurns: async (boardId, from, before) => sorted
      .filter((turn) => turn.boardId === boardId && turn.orderIndex >= from && (before === null || turn.orderIndex < before))
      .slice(0, PAGE_FIGURE_MAX_TURNS_BETWEEN + 2)
      .map((turn) => ({
        id: turn.id, boardId: turn.boardId, userId: turn.userId, orderIndex: turn.orderIndex, question: turn.question,
        visualStatus: turn.visualStatus, sceneArtifacts: turn.sceneArtifacts, segments: turn.segments, kind: turn.kind ?? null,
      })),
  };
}

/** The Prisma reads, for the save routes. */
export function prismaPageFigureStore(db: {
  turn: {
    findFirst(args: { where: { id: string }; select: typeof PAGE_FIGURE_TURN_SELECT }): Promise<unknown>;
    findMany(args: {
      where: { boardId: string; orderIndex?: { gt?: number; gte?: number; lt?: number } };
      select: typeof PAGE_WALK_TURN_SELECT | typeof PAGE_ZONE_TURN_SELECT;
      orderBy: { orderIndex: "asc" | "desc" };
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
        select: PAGE_WALK_TURN_SELECT,
        orderBy: { orderIndex: "asc" },
        take: PAGE_FIGURE_MAX_TURNS_BETWEEN + 1,
      })) as PageWalkTurn[],
    turnsBefore: async (boardId, before) =>
      (await db.turn.findMany({
        where: before === null ? { boardId } : { boardId, orderIndex: { lt: before } },
        select: PAGE_WALK_TURN_SELECT,
        orderBy: { orderIndex: "desc" },
        take: PAGE_FIGURE_MAX_TURNS_BETWEEN + 2,
      })) as PageWalkTurn[],
    pageTurns: async (boardId, from, before) =>
      (await db.turn.findMany({
        where: { boardId, orderIndex: before === null ? { gte: from } : { gte: from, lt: before } },
        select: PAGE_ZONE_TURN_SELECT,
        orderBy: { orderIndex: "asc" },
        take: PAGE_FIGURE_MAX_TURNS_BETWEEN + 2,
      })) as PageZoneTurn[],
  };
}

/** The production binding for one save: Prisma reads and the stored picture loader. */
export function pageFigureLoaderFor(
  context: PageFigureContext,
  db: Parameters<typeof prismaPageFigureStore>[0],
): PageFigureLoader {
  return bindPageFigureLoader(context, { store: prismaPageFigureStore(db) });
}

/** The production lesson figure start for one resume save. */
export function lessonFigureStartFor(
  context: PageFigureContext,
  db: Parameters<typeof prismaPageFigureStore>[0],
): LessonFigureStartLoader {
  return bindLessonFigureStart(context, { store: prismaPageFigureStore(db) });
}

/** The production doubt figure page check for one save. */
export function doubtFigurePageCheckFor(
  context: PageFigureContext,
  db: Parameters<typeof prismaPageFigureStore>[0],
): DoubtFigurePageCheck {
  return bindDoubtFigurePageCheck(context, { store: prismaPageFigureStore(db) });
}
