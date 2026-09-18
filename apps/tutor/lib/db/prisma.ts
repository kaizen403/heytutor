import { PrismaClient } from "@prisma/client";
import { withPrismaPoolLimits } from "./databaseUrl";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL?.trim();
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(url ? { datasources: { db: { url: withPrismaPoolLimits(url) } } } : {}),
  });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

// Next compiles API routes into more than one chunk. Without this, production
// mints a PrismaClient per chunk and Neon exhausts connections until queries hang.
globalForPrisma.prisma = prisma;
