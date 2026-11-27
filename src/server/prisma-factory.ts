import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient;

/** Creates a Prisma client bound to the SQLite file in DATABASE_URL (relative to the cwd). */
export function createPrismaClient(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  }
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}
