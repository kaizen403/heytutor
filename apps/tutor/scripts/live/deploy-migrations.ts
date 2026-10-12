import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface AppliedMigration {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

class MigrationHistoryError extends Error {}

/** Preserve legacy names/SQL; let Prisma apply and record each pending migration. */
export async function deployMigrations(schemaPath = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url))) {
  const migrationRoot = join(dirname(schemaPath), "migrations");
  const migrations = readdirSync(migrationRoot)
    .filter((name) => existsSync(join(migrationRoot, name, "migration.sql")))
    .map((name) => {
      const prefix = /^(\d+)_/.exec(name)?.[1];
      if (!prefix) throw new MigrationHistoryError("Migration names must start with their ordered numeric prefix.");
      const sql = readFileSync(join(migrationRoot, name, "migration.sql"));
      return { name, order: BigInt(prefix), sql, checksum: createHash("sha256").update(sql).digest("hex") };
    })
    .sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new MigrationHistoryError("DATABASE_URL is required.");
  const databaseSchema = new URL(databaseUrl).searchParams.get("schema") ?? "public";
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(databaseSchema)) throw new MigrationHistoryError("Unsupported database schema name.");
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  let history: AppliedMigration[];
  try {
    history = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const table = await tx.$queryRaw<{ name: string | null }[]>`SELECT to_regclass(${`"${databaseSchema}"."_prisma_migrations"`})::text AS name`;
      if (!table[0]?.name) return [];
      return tx.$queryRawUnsafe<AppliedMigration[]>(`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "${databaseSchema}"."_prisma_migrations"`);
    });
  } finally {
    await db.$disconnect();
  }
  const applied = new Set<string>();
  for (const row of history) {
    if (row.rolled_back_at) continue;
    if (!row.finished_at) throw new MigrationHistoryError(`Migration ${row.migration_name} is unfinished; recover it explicitly with Prisma before deploying.`);
    const source = migrations.find((migration) => migration.name === row.migration_name);
    if (!source || source.checksum !== row.checksum) throw new MigrationHistoryError(`Applied migration ${row.migration_name} is missing or changed; deployment refused.`);
    applied.add(row.migration_name);
  }
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  const runPrisma = (path: string) => {
    const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", path], { stdio: "inherit" });
    if (result.error || result.status !== 0) throw new Error("Prisma migrate deploy failed; inspect its migration history before retrying.");
  };
  if (migrations.every((migration) => applied.has(migration.name))) {
    runPrisma(schemaPath);
    return;
  }
  const stage = mkdtempSync(join(tmpdir(), "heytutor-migrations-"));
  try {
    const stagedSchema = join(stage, "schema.prisma");
    const stagedMigrations = join(stage, "migrations");
    writeFileSync(stagedSchema, readFileSync(schemaPath));
    mkdirSync(stagedMigrations);
    const lock = join(migrationRoot, "migration_lock.toml");
    if (existsSync(lock)) writeFileSync(join(stagedMigrations, "migration_lock.toml"), readFileSync(lock));
    const stageMigration = (migration: (typeof migrations)[number]) => {
      const directory = join(stagedMigrations, migration.name);
      mkdirSync(directory);
      writeFileSync(join(directory, "migration.sql"), migration.sql);
    };
    for (const migration of migrations) if (applied.has(migration.name)) stageMigration(migration);
    // Only the next pending file is exposed at each step. Prisma still owns
    // the advisory lock, execution, checksum and original migration record.
    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;
      stageMigration(migration);
      runPrisma(stagedSchema);
    }
    runPrisma(schemaPath);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  deployMigrations().catch((error: unknown) => {
    console.error(error instanceof MigrationHistoryError ? error.message : "Migration deployment failed. Inspect Prisma's output and recover unfinished or changed history explicitly; existing migrations were not rewritten.");
    process.exitCode = 1;
  });
}
