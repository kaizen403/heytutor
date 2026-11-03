/**
 * LOCAL ONLY. Seeds synthetic saved lessons with every reference picture
 * outcome so the admin Pictures page can be exercised on an empty database.
 * Refuses to run unless DATABASE_URL points at localhost and the database is
 * `heytutor_cheyenne`. Every row hangs off one synthetic user (deleted with
 * cascade) or carries the `seed-admin-pictures:` key prefix, so a rerun
 * replaces the seed and `--clean` removes it.
 *
 *   pnpm --filter @heytutor/tutor exec dotenv -e .env.local -- tsx scripts/live/seed-admin-pictures.ts [--clean] [--sample <file>]
 *
 * `--sample <file>` writes the 30 day report the admin API would return.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { REFERENCE_PICTURE_PLAN_VERSION, referencePictureAssetUrls, type ReferencePictureRecord } from "@heytutor/drawing";
import { SCENE_ARTIFACTS_V3_VERSION } from "@heytutor/scene-engine";
import { storedReferencePictureFrom, type ReferencePictureOutcome } from "@/features/tutor-session/lib/scene/referencePicturePresentation";
import { picturesWindow } from "@/lib/admin/pictures";
import { loadPicturesReport } from "@/lib/admin/picturesQueries";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOCAL_DATABASE = "heytutor_cheyenne";
const SEED = "seed-admin-pictures";
const USER_ID = "seed_admin_pictures";
const BOARD_ID = "seed_admin_pictures_board";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A 1x1 white PNG, only for the synthetic picture when the local library is empty. */
const WHITE_PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

function localDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set; run with dotenv -e .env.local");
  const url = new URL(raw);
  const database = url.pathname.replace(/^\//, "");
  if (!LOCAL_HOSTS.has(url.hostname) || database !== LOCAL_DATABASE) {
    throw new Error(`refusing to seed ${url.hostname}/${database}: this script runs only on localhost/${LOCAL_DATABASE}`);
  }
  return raw;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function clean(db: PrismaClient) {
  await db.user.deleteMany({ where: { id: USER_ID } });
  await db.referencePictureQuery.deleteMany({ where: { queryKey: { startsWith: `${SEED}:` } } });
  await db.referencePicture.deleteMany({ where: { sourceKey: { startsWith: `${SEED}:` } } });
}

/** A real stored picture when there is one, so the library join counts it; else one synthetic picture. */
async function pictureForSeed(db: PrismaClient): Promise<ReferencePictureRecord> {
  const existing = await db.referencePicture.findFirst({ where: { NOT: { sourceKey: { startsWith: `${SEED}:` } } }, orderBy: { createdAt: "asc" }, select: { id: true, record: true } });
  if (existing) return { ...(existing.record as unknown as ReferencePictureRecord), ...referencePictureAssetUrls(existing.id) };
  const sourceKey = `${SEED}:synthetic`;
  const id = `rp_${createHash("sha256").update(`reference-picture:${sourceKey}`).digest("hex").slice(0, 24)}`;
  const pass = { brushPx: 4, strokes: [[0, 0, 1, 1]], lengthPx: 1.4 };
  const record = { id, source: "generated" as const, title: "Synthetic seed picture", pageUrl: null, license: "CC0", licenseUrl: null,
    artist: "seed", width: 1, height: 1, shows: "synthetic seed picture", labels: ["seed"], plan: { width: 1, height: 1, outlineLengthPx: 1, fillLengthPx: 1 } };
  await db.referencePicture.create({ data: { id, sourceKey, source: "generated", record: record as unknown as Prisma.InputJsonValue,
    plan: { version: REFERENCE_PICTURE_PLAN_VERSION, width: 1, height: 1, paper: "#ffffff", inkMask: `data:image/png;base64,${WHITE_PIXEL}`, outline: pass, fill: pass },
    image: new Uint8Array(Buffer.from(WHITE_PIXEL, "base64")), imageType: "image/png" } });
  return { ...(record as unknown as ReferencePictureRecord), ...referencePictureAssetUrls(id) };
}

interface SeedTurn {
  question: string;
  ageMs: number;
  subject?: "maths" | "physics" | "chemistry" | "other";
  requirement?: "required" | "optional" | "none";
  visual?: "validated" | "text_only";
  outcome?: ReferencePictureOutcome;
  /** The server saved the picture: `sceneArtifacts.referencePicture`. */
  saved?: boolean;
  degradation?: string;
  kind?: "lesson" | "doubt" | "resume";
  status?: "complete" | "stopped" | "live";
}

const shown = (ms: number, speculative: boolean): ReferencePictureOutcome => ({ attempted: true, status: "shown", reason: null, ms, speculative });
const failed = (status: "declined" | "unavailable" | "skipped", reason: string, ms: number, speculative = false): ReferencePictureOutcome =>
  ({ attempted: true, status, reason, ms, speculative });

/** One lesson per case the page must tell apart, plus the rows it must not count. */
const TURNS: SeedTurn[] = [
  { question: "[seed] Explain the structure of a neuron.", ageMs: 2 * HOUR, subject: "other", requirement: "required", outcome: shown(14_200, true), saved: true },
  { question: "[seed] Describe the human heart and blood flow.", ageMs: 26 * HOUR, subject: "other", requirement: "required", outcome: shown(9_100, true), saved: true },
  { question: "[seed] Sketch the locus |z - 2| = 3 on an Argand diagram.", ageMs: 3 * HOUR, subject: "maths", requirement: "required", outcome: shown(21_000, false), saved: true, degradation: "candidate_invalid" },
  { question: "[seed] Label the parts of a flower.", ageMs: 5 * HOUR, subject: "other", requirement: "optional", outcome: shown(11_500, true), saved: false, status: "stopped" },
  { question: "[seed] Explain the working of an AC generator.", ageMs: 6 * HOUR, subject: "physics", requirement: "required", outcome: failed("declined", "no_candidate_accepted", 17_800), degradation: "missing_capability" },
  { question: "[seed] Explain the structure of a nephron.", ageMs: 30 * HOUR, subject: "other", requirement: "required", outcome: failed("declined", "cached_no_candidates", 1_900, true) },
  { question: "[seed] Describe simple distillation apparatus.", ageMs: 2 * DAY, subject: "chemistry", requirement: "required", outcome: failed("unavailable", "wait_deadline", 25_000), degradation: "candidate_invalid" },
  { question: "[seed] Describe the double helix of DNA.", ageMs: 3 * DAY, subject: "other", requirement: "optional", outcome: failed("unavailable", "preload_failed", 12_000, true) },
  { question: "[seed] Prove the angle in a semicircle is a right angle.", ageMs: 4 * HOUR, subject: "maths", requirement: "required" },
  { question: "[seed] Explain the transformer principle.", ageMs: 8 * HOUR, outcome: failed("declined", "no_candidates", 15_400) },
  // Not needed: the engine drew (one after an early request), or the plan said no figure.
  { question: "[seed] Draw the electric field of a dipole.", ageMs: 30 * 60_000, subject: "physics", requirement: "required", visual: "validated" },
  { question: "[seed] Draw the cell cycle.", ageMs: 7 * HOUR, subject: "other", requirement: "required", visual: "validated", outcome: failed("skipped", "verified_figure", 8_000, true) },
  { question: "[seed] Write a short essay on the French Revolution.", ageMs: 1 * HOUR, subject: "other", requirement: "none", outcome: failed("skipped", "not_waited", 3_000, true) },
  // Never counted: a doubt, a resume copying its lesson's outcome, a lesson still live.
  { question: "[seed] Doubt: why is the axon long?", ageMs: 2 * HOUR - 60_000, subject: "other", requirement: "required", outcome: shown(14_200, true), saved: true, kind: "doubt" },
  { question: "[seed] Continue the neuron lesson.", ageMs: 2 * HOUR - 120_000, subject: "other", requirement: "required", outcome: shown(14_200, true), saved: true, kind: "resume" },
  { question: "[seed] Explain the eye (still teaching).", ageMs: 10 * 60_000, subject: "other", requirement: "required", outcome: shown(13_000, true), saved: true, status: "live" },
  // Outside the 7 day period, inside 30 and 90.
  { question: "[seed] Describe the digestive system.", ageMs: 10 * DAY, subject: "other", requirement: "required", outcome: shown(16_000, true), saved: true },
  { question: "[seed] Explain photosynthesis.", ageMs: 40 * DAY, subject: "other", requirement: "required", outcome: failed("declined", "no_candidate_accepted", 19_000, true) },
];

function artifacts(turn: SeedTurn, picture: ReferencePictureRecord): Prisma.InputJsonValue {
  const drew = turn.visual === "validated";
  return {
    schemaVersion: SCENE_ARTIFACTS_V3_VERSION,
    seed: SEED,
    ...(turn.requirement ? { turnPlan: { visualRequirement: turn.requirement } } : {}),
    figureSource: drew ? "planner" : "text_only",
    diagramResultStatus: drew ? "ready" : "text_only",
    ...(turn.degradation ? { degradation: { reason: turn.degradation, issueCodes: [], candidateCount: 1 } } : {}),
    ...(turn.subject ? { failureTelemetry: { subject: turn.subject } } : {}),
    ...(turn.saved ? { referencePicture: { ...storedReferencePictureFrom(picture) } } : {}),
    ...(turn.outcome ? { referencePictureOutcome: { ...turn.outcome } } : {}),
  } as unknown as Prisma.InputJsonValue;
}

async function main() {
  const db = new PrismaClient({ log: [], datasources: { db: { url: localDatabaseUrl() } } });
  try {
    await clean(db);
    if (process.argv.includes("--clean")) {
      console.log("removed the seed rows");
      return;
    }
    const now = Date.now();
    const picture = await pictureForSeed(db);
    await db.user.create({ data: { id: USER_ID, name: "Seed admin pictures (synthetic)" } });
    await db.board.create({ data: { id: BOARD_ID, userId: USER_ID, title: "Seed: reference picture analytics" } });
    for (const [index, turn] of TURNS.entries()) {
      await db.turn.create({ data: {
        boardId: BOARD_ID, userId: USER_ID, orderIndex: index, question: turn.question, rawResponse: "",
        visualStatus: turn.visual ?? "text_only", status: turn.status ?? "complete", kind: turn.kind ?? "lesson",
        sceneArtifacts: artifacts(turn, picture), createdAt: new Date(now - turn.ageMs),
      } });
    }
    const declines = [["no_candidate_accepted", 2 * HOUR], ["plan_failed", 1 * HOUR], ["no_candidates", 30 * HOUR]] as const;
    for (const [index, [reason, ageMs]] of declines.entries()) {
      await db.referencePictureQuery.create({ data: { queryKey: `${SEED}:${index}`, pictureId: null, reason, createdAt: new Date(now - ageMs) } });
    }
    console.log(`seeded ${TURNS.length} turns and ${declines.length} cached declines; shown turns use ${picture.id} (${picture.title})`);
    const sample = arg("sample");
    if (sample) {
      const report = await loadPicturesReport(db, picturesWindow(30, now), now);
      const path = resolve(process.cwd(), sample);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`wrote ${path}`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
