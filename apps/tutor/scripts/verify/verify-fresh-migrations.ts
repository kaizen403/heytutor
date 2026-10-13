import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("../../", import.meta.url));
const schema = join(app, "prisma/schema.prisma");
const runner = join(app, "scripts/live/deploy-migrations.ts");
const require = createRequire(import.meta.url);
const tsx = require.resolve("tsx/cli");
const cli = require.resolve("prisma/build/index.js");
const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
assert(databaseUrl, "MIGRATION_TEST_DATABASE_URL must identify a new disposable loopback database.");
const address = new URL(databaseUrl);
assert(["127.0.0.1", "localhost", "[::1]"].includes(address.hostname), "Only loopback database fixtures are allowed.");
assert(/^\/heytutor_migrations_verify_[a-zA-Z0-9_]+$/.test(address.pathname), "Use an owned heytutor_migrations_verify_* database.");
assert(!address.searchParams.has("schema") || address.searchParams.get("schema") === "public", "The gate starts in a fresh public schema.");
const env = { ...process.env, DATABASE_URL: databaseUrl };
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const sqlFiles = readdirSync(join(app, "prisma/migrations")).filter((name) => /^\d+_/.test(name));
const checksums = Object.fromEntries(sqlFiles.map((name) => [name, createHash("sha256").update(readFileSync(join(app, "prisma/migrations", name, "migration.sql"))).digest("hex")]));
const legacy = JSON.parse(readFileSync(join(app, "prisma/legacy-migration-checksums.json"), "utf8")) as Record<string, string>;
for (const [name, checksum] of Object.entries(legacy)) assert.equal(checksums[name], checksum, `Applied legacy migration ${name} must remain unchanged.`);
const receipts: string[] = [];
function run(script = runner, childEnv = env) {
  const child = spawnSync(process.execPath, [tsx, script], { cwd: app, env: childEnv, encoding: "utf8", timeout: 180_000, maxBuffer: 4_000_000 });
  assert(!child.error, "Migration consumer must run successfully, not fail at process setup.");
  return child;
}
interface MigrationRow { migration_name: string; checksum: string; finished_at: Date; rolled_back_at: Date | null; id: string }
const history = () => db.$queryRaw<MigrationRow[]>`SELECT migration_name, checksum, finished_at, rolled_back_at, id FROM public."_prisma_migrations" ORDER BY started_at, migration_name`;
async function main() {
  let scratch: string | undefined;
  try {
    const tables = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_tables WHERE schemaname = 'public'`;
    assert.equal(tables[0]?.count, 0n, "Refuse to reuse or reset a nonempty database.");
    const migrated = run();
    assert.equal(migrated.status, 0, "Ordered actual Prisma migrate deploy must migrate the empty database.");
    const rows = await history();
    assert.equal(rows.length, sqlFiles.length);
    for (const row of rows) {
      assert(row.finished_at && !row.rolled_back_at, `${row.migration_name} must finish successfully.`);
      assert.equal(row.checksum, checksums[row.migration_name], "Prisma must record the original SQL/name.");
    }
    receipts.push("empty database migrated by actual Prisma CLI; all original names and checksums retained");
    const columns = await db.$queryRaw<{ column_name: string; data_type: string; column_default: string | null }[]>`SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_settings'`;
    assert.equal(columns.find((row) => row.column_name === "marker_stunts")?.data_type, "ARRAY");
    assert.equal(columns.find((row) => row.column_name === "speed_multiplier")?.column_default, "1.25");
    const notes = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'board_chat_messages' AND column_name IN ('tag', 'storage_bytes')`;
    assert.equal(notes[0]?.count, 2n);
    const checks = await db.$queryRaw<{ definition: string }[]>`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'public.billing_purchases'::regclass AND contype = 'c'`;
    assert(checks.some((row) => row.definition.includes("amount > 0")), "Custom SQL CHECK constraints must survive; db push is not a migration substitute.");
    receipts.push("dependent settings/notes columns, final defaults and custom billing CHECK preserved");

    await db.$executeRaw`INSERT INTO users (id) VALUES ('migration-gate-existing-user')`;
    await db.$executeRaw`INSERT INTO user_settings (user_id, speed_multiplier, marker_stunts, fast_mode) VALUES ('migration-gate-existing-user', 0.9, ARRAY['underline']::text[], false)`;
    const snapshot = () => db.$queryRaw`SELECT row_to_json(settings) AS value FROM public.user_settings settings WHERE user_id = 'migration-gate-existing-user'`;
    const before = await snapshot();
    assert.equal(run().status, 0, "An existing, fully applied history must deploy again.");
    assert.deepEqual(await snapshot(), before, "Existing account preferences must stay identical.");
    assert.deepEqual(await history(), rows, "No old migration record may be renamed or replaced.");
    receipts.push("repeat deployment leaves existing settings and original migration records identical");

    // Only this strictly owned local fixture is edited to exercise failed and
    // changed history. The deploy consumer must refuse before touching it.
    const first = rows[0]!;
    await db.$executeRaw`UPDATE public."_prisma_migrations" SET checksum = ${"0".repeat(64)} WHERE id = ${first.id}`;
    const changedHistory = await history();
    const changed = run();
    assert.notEqual(changed.status, 0);
    assert.match(changed.stderr, /missing or changed; deployment refused/);
    assert.deepEqual(await history(), changedHistory);
    assert.deepEqual(await snapshot(), before);
    await db.$executeRaw`UPDATE public."_prisma_migrations" SET checksum = ${first.checksum}, finished_at = NULL WHERE id = ${first.id}`;
    const unfinishedHistory = await history();
    const unfinished = run();
    assert.notEqual(unfinished.status, 0);
    assert.match(unfinished.stderr, /unfinished; recover it explicitly/);
    assert.deepEqual(await history(), unfinishedHistory);
    assert.deepEqual(await snapshot(), before);
    await db.$executeRaw`UPDATE public."_prisma_migrations" SET finished_at = ${first.finished_at} WHERE id = ${first.id}`;
    assert.deepEqual(await history(), rows);
    receipts.push("changed and unfinished local history refused without migration or preference mutation");

    scratch = mkdtempSync(join(dirname(runner), ".verify-migrations-"));
    const source = readFileSync(runner, "utf8");
    const sorter = '.sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0)';
    assert(source.includes(sorter), "The mutation must target actual ordering.");
    const mutation = join(scratch, "mutant.ts");
    writeFileSync(mutation, source.replace(sorter, '.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)'));
    const entry = join(scratch, "entry.mts");
    writeFileSync(entry, `import { deployMigrations } from ${JSON.stringify(mutation)}; await deployMigrations(${JSON.stringify(schema)});\n`);
    await db.$executeRawUnsafe('CREATE SCHEMA "migration_gate_lexical_mutation"');
    const mutantUrl = new URL(address.href);
    mutantUrl.searchParams.set("schema", "migration_gate_lexical_mutation");
    const red = run(entry, { ...env, DATABASE_URL: mutantUrl.toString() });
    assert.notEqual(red.status, 0, "Removing numeric ordering must fail.");
    assert.match(red.stdout + red.stderr, /P3018/);
    assert.match(red.stdout + red.stderr, /user_settings.*does not exist/s);
    receipts.push("lexical-order mutation fails semantically with P3018/missing user_settings, not setup failure");

    // Verify schema compatibility through the real Prisma diff consumer too.
    const diff = spawnSync(process.execPath, [cli, "migrate", "diff", "--from-schema-datasource", schema, "--to-schema-datamodel", schema, "--exit-code", "--script"], { cwd: app, env, encoding: "utf8", timeout: 45_000 });
    assert(!diff.error);
    // The unchanged legacy chain already has these two model differences.
    // Pin them explicitly rather than rewriting production's applied SQL or
    // treating arbitrary schema drift as a successful empty installation.
    const expectedLegacyDiff = 'DROP INDEX "billing_period_spend_user_id_idx"; ALTER TABLE "home_suggestion_cache" ALTER COLUMN "packs" DROP DEFAULT;';
    const ddl = diff.stdout.replace(/^--.*$/gm, "").replace(/\s+/g, " ").trim();
    assert.equal(diff.status, 2, "Prisma must report only the pinned legacy model differences.");
    assert.equal(ddl, expectedLegacyDiff, "Reject additional schema drift beyond the immutable legacy index/default.");
    receipts.push("actual Prisma diff retains only the two pinned legacy index/default differences");
    console.log(JSON.stringify({ gate: "fresh-migrations", status: "PASS", receipts, productionActions: 0, providerCalls: 0 }));
  } finally {
    await db.$disconnect();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }

}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
