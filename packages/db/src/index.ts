import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export * from "./generated/prisma/client.js";

export type Db = PrismaClient;

/**
 * Creates a Prisma client on the node-postgres driver adapter.
 * DATABASE_POOL_MAX caps the connection pool; `prisma dev` needs 1 because its
 * local Postgres mixes up queries that arrive on parallel connections.
 */
export function createDb(
  connectionString = process.env.DATABASE_URL,
  poolMax = Number(process.env.DATABASE_POOL_MAX) || undefined,
): Db {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaPg({ connectionString, ...(poolMax ? { max: poolMax } : {}) });
  return new PrismaClient({ adapter });
}
