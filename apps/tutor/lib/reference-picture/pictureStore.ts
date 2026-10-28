import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { isReferencePictureId, normalizeReferencePictureLabels, parseReferencePictureLegend, parseReferencePictureParts, parseReferencePicturePlan, referencePictureAssetUrls, referencePictureLayout, type ReferencePicturePlan, type ReferencePictureRecord } from "@heytutor/drawing";
import { prisma } from "@/lib/db/prisma";
import { resolveReferencePicturePartFocusEnabled } from "@/lib/scene/diagramStrategy.server";
import { ACCEPT_TTL_MS, DECLINE_TTL_MS } from "./cachePolicy";

/**
 * Stored reference pictures. A row exists only for a picture the judge
 * accepted, so the id is the authority: persistence and replay resolve a
 * DRAW_PICTURE command back to this row and drop it when the row is missing.
 */

export { ACCEPT_TTL_MS, DECLINE_TTL_MS };

export function pictureIdFor(sourceKey: string): string {
  return `rp_${createHash("sha256").update(`reference-picture:${sourceKey}`).digest("hex").slice(0, 24)}`;
}

/**
 * Normalise a "must show" phrase so near-identical asks share one cache row.
 * Null when too little is left to tell topics apart (only filler words), so
 * unrelated asks never share a row.
 */
export function queryKeyFor(mustShow: string): string | null {
  const normalised = mustShow.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/(^|\s)(a|an|the|of|and|labelled|labeled|diagram|showing|its|with)(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
  if ([...normalised.replace(/\s/g, "")].length < 4) return null;
  return createHash("sha256").update(normalised).digest("hex").slice(0, 40);
}

type StoredRecord = Omit<ReferencePictureRecord, "imageUrl" | "planUrl">;

function withUrls(record: StoredRecord): ReferencePictureRecord {
  const urls = referencePictureAssetUrls(record.id);
  return { ...record, imageUrl: urls.imageUrl, planUrl: urls.planUrl };
}

/**
 * A record as the rest of the server sees it. Located parts (stored with
 * part focus on, or by the backfill) are served only with
 * `REFERENCE_PICTURE_PART_FOCUS=on`: off, the
 * record has no `parts` key at all, exactly as before parts existed. On,
 * they are validated again against the record (a part whose name or box no
 * longer holds is dropped alone).
 */
export function servedRecord(record: StoredRecord, partFocus = resolveReferencePicturePartFocusEnabled()): ReferencePictureRecord {
  const { parts: raw, ...rest } = record;
  const parts = partFocus && raw !== undefined ? parseReferencePictureParts(raw, rest) : [];
  return withUrls(parts.length ? { ...rest, parts } : rest);
}

/**
 * A stored record, or null when it is not one. A numbered picture's key is
 * checked again here: a record whose key is malformed or no longer fits
 * beside the picture resolves to nothing, so persistence strips the picture
 * rather than drawing its numbers without names.
 */
function parseStoredRecord(id: string, raw: unknown): ReferencePictureRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<StoredRecord>;
  if (r.id !== id || (r.source !== "wikimedia" && r.source !== "generated") || !r.plan || typeof r.title !== "string") return null;
  // Records stored before the label rule may hold captions; they are dropped, never fatal.
  r.labels = normalizeReferencePictureLabels(r.labels);
  if (r.legend !== undefined) {
    const legend = parseReferencePictureLegend(r.legend);
    if (!legend || !referencePictureLayout({ plan: r.plan, legend })) return null;
    return servedRecord({ ...(r as StoredRecord), legend });
  }
  return servedRecord(r as StoredRecord);
}

export async function loadReferencePictureRecord(id: string): Promise<ReferencePictureRecord | null> {
  if (!isReferencePictureId(id)) return null;
  const row = await prisma.referencePicture.findUnique({ where: { id }, select: { record: true } });
  return row ? parseStoredRecord(id, row.record) : null;
}

export async function loadReferencePicturePlan(id: string): Promise<ReferencePicturePlan | null> {
  if (!isReferencePictureId(id)) return null;
  const row = await prisma.referencePicture.findUnique({ where: { id }, select: { plan: true } });
  return row ? parseReferencePicturePlan(row.plan) : null;
}

export async function loadReferencePictureImage(id: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!isReferencePictureId(id)) return null;
  const row = await prisma.referencePicture.findUnique({ where: { id }, select: { image: true, imageType: true } });
  return row ? { bytes: row.image, contentType: row.imageType } : null;
}

export async function findPictureBySourceKey(sourceKey: string): Promise<ReferencePictureRecord | null> {
  const row = await prisma.referencePicture.findUnique({ where: { sourceKey }, select: { id: true, record: true } });
  return row ? parseStoredRecord(row.id, row.record) : null;
}

/** Store an accepted picture. A concurrent insert of the same source wins. */
export async function saveReferencePicture(input: { sourceKey: string; record: StoredRecord; plan: ReferencePicturePlan; image: Buffer; imageType: string }): Promise<ReferencePictureRecord> {
  try {
    await prisma.referencePicture.create({
      data: {
        id: input.record.id,
        sourceKey: input.sourceKey,
        source: input.record.source,
        record: input.record as unknown as Prisma.InputJsonValue,
        plan: input.plan as unknown as Prisma.InputJsonValue,
        image: new Uint8Array(input.image),
        imageType: input.imageType,
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    const winner = await findPictureBySourceKey(input.sourceKey);
    if (winner) return winner;
    throw error;
  }
  return servedRecord(input.record);
}

export type CachedQuery = { status: "ready"; picture: ReferencePictureRecord } | { status: "declined"; reason: string } | null;

export async function readQueryCache(queryKey: string, now = Date.now()): Promise<CachedQuery> {
  const row = await prisma.referencePictureQuery.findUnique({ where: { queryKey } });
  if (!row) return null;
  if (row.pictureId) {
    if (now - row.createdAt.getTime() >= ACCEPT_TTL_MS) return null;
    const picture = await loadReferencePictureRecord(row.pictureId);
    return picture ? { status: "ready", picture } : null;
  }
  return now - row.createdAt.getTime() < DECLINE_TTL_MS ? { status: "declined", reason: row.reason ?? "no_picture" } : null;
}

export async function writeQueryCache(queryKey: string, outcome: { pictureId: string } | { reason: string }): Promise<void> {
  const data = "pictureId" in outcome ? { pictureId: outcome.pictureId, reason: null } : { pictureId: null, reason: outcome.reason.slice(0, 200) };
  await prisma.referencePictureQuery.upsert({ where: { queryKey }, create: { queryKey, ...data }, update: { ...data, createdAt: new Date() } });
}

/** Asset responses are public on purpose: free licence pictures, no student data, and the landing replay is anonymous. Ids are content-addressed, so a response never changes. */
export const IMMUTABLE_ASSET_HEADERS = { "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } as const;