import "server-only";
import { createPrismaClient, type Db } from "./prisma-factory";

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { __mintPrisma?: Db };

export const db: Db = globalForPrisma.__mintPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.__mintPrisma = db;
