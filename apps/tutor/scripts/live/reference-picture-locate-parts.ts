/**
 * Locate parts for reference pictures stored before the part locator existed
 * (or again, after it changed). Free: no model is asked; it reads each Commons
 * file's original SVG, politely, one at a time. Dry run by default: it prints
 * what it would store. `--write` updates each changed row's record JSON.
 * Writes to whatever database DATABASE_URL names, so point it at production
 * only on purpose.
 *
 *   pnpm --filter @heytutor/tutor exec dotenv -e .env.local -- tsx scripts/live/reference-picture-locate-parts.ts [--write] [--id rp_...] [--limit 50]
 *
 * Idempotent: a second run finds every row unchanged. A generated picture has
 * no SVG, and the raster reader is not shipped (OCR pointed at the wrong copy
 * of a name on real pictures), so it is skipped. So is a row whose Commons
 * file was re-uploaded after the row was stored (or whose upload time is
 * unknown): Commons serves only the current revision, whose labels may have
 * moved, and the stored picture is the older one.
 */
import { Prisma } from "@prisma/client";
import { normalizeReferencePictureLabels, parseReferencePictureLegend, parseReferencePicturePlan } from "@heytutor/drawing";
import { prisma } from "@/lib/db/prisma";
import { locateReferencePictureParts, recordWithParts } from "@/lib/reference-picture/partLocator";
import { commonsFileInfo } from "@/lib/reference-picture/wikimediaSearch";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** JSON with keys sorted: Postgres JSONB stores keys in its own order, so a plain stringify would call every stored row changed. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const only = arg("id");
  const limit = Number(arg("limit") ?? "") || undefined;
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").host; } catch { return "unknown"; } })();
  const rows = await prisma.referencePicture.findMany({
    where: only ? { id: only } : {},
    select: { id: true, sourceKey: true, source: true, record: true, plan: true, image: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    ...(limit ? { take: limit } : {}),
  });
  console.log(`${write ? "WRITING" : "dry run"}: ${rows.length} pictures in ${host}`);
  const tally = { changed: 0, unchanged: 0, skipped: 0, failed: 0, parts: 0 };
  for (const row of rows) {
    const record = row.record as Record<string, unknown> | null;
    const plan = parseReferencePicturePlan(row.plan);
    const title = row.sourceKey.startsWith("wikimedia:") ? row.sourceKey.slice("wikimedia:".length) : null;
    if (!record || !plan || !title) {
      tally.skipped++;
      console.log(`skip     ${row.id}  ${!title ? "generated picture" : "unreadable record or plan"}`);
      continue;
    }
    const legend = record.legend === undefined ? null : parseReferencePictureLegend(record.legend);
    if (record.legend !== undefined && !legend) { tally.skipped++; console.log(`skip     ${row.id}  malformed key`); continue; }
    try {
      const file = await commonsFileInfo(title);
      if (!file) { tally.skipped++; console.log(`skip     ${row.id}  ${title}: not on Commons`); continue; }
      const uploaded = file.timestamp ? Date.parse(file.timestamp) : Number.NaN;
      if (!Number.isFinite(uploaded) || uploaded > row.createdAt.getTime()) {
        tally.skipped++;
        console.log(`skip     ${row.id}  ${title}: Commons revision ${file.timestamp ?? "of unknown date"} is newer than the stored picture (${row.createdAt.toISOString()})`);
        continue;
      }
      const located = await locateReferencePictureParts({
        candidate: file,
        plan,
        picturePng: Buffer.from(row.image),
        labels: normalizeReferencePictureLabels(record.labels),
        legend,
      });
      const next = recordWithParts(record, located.parts);
      const same = canonical(next) === canonical(record);
      tally[same ? "unchanged" : "changed"]++;
      tally.parts += located.parts.length;
      console.log(`${same ? "same    " : "CHANGED "} ${row.id}  ${title}  ${located.step}`);
      if (write && !same) await prisma.referencePicture.update({ where: { id: row.id }, data: { record: next as unknown as Prisma.InputJsonValue } });
    } catch (error) {
      tally.failed++;
      console.log(`failed   ${row.id}  ${title}: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Wikimedia asks for a gentle rate.
    await sleep(500);
  }
  console.log(`done: ${tally.changed} ${write ? "updated" : "would change"}, ${tally.unchanged} unchanged, ${tally.skipped} skipped, ${tally.failed} failed; ${tally.parts} parts located`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
